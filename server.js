// Dota Coach — локальний сервер.
//  * приймає дані з Dota 2 (Game State Integration) на POST /gsi
//  * після кінця катки зберігає її в data/matches
//  * віддає гарний інтерфейс на http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { GsiSession } = require('./src/gsi');
const { analyze } = require('./src/analyzer');
const od = require('./src/opendota');

const PORT = Number(process.env.PORT) || 3000;
const TOKEN = 'dotacoach_local_9f3k';
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const MATCHES = path.join(DATA, 'matches');
const SETTINGS = path.join(DATA, 'settings.json');
fs.mkdirSync(MATCHES, { recursive: true });

// ---------- зберігання
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const settings = () => readJson(SETTINGS, {});
const saveSettings = (s) => fs.writeFileSync(SETTINGS, JSON.stringify({ ...settings(), ...s }, null, 2));
const matchFile = (id) => path.join(MATCHES, String(id).replace(/[^\w-]/g, '') + '.json');
const loadMatch = (id) => readJson(matchFile(id), null);
const saveMatch = (m) => fs.writeFileSync(matchFile(m.id), JSON.stringify(m));

async function buildReport(m, role) {
  const [heroes, items] = await Promise.all([od.safe(od.heroes, null), od.safe(od.items, null)]);
  const heroId = heroes?.byName?.[m.hero]?.id;
  const bench = m.odPct && Object.keys(m.odPct).length ? null : await od.safe(() => od.benchmarks(heroId), null);
  return analyze(m, { role: role || m.role, heroes, items, bench });
}

// ---------- GSI
const session = new GsiSession({
  onAccount: (id) => { if (settings().accountId !== id) saveSettings({ accountId: id }); },
  onFinish: async (m) => {
    if (m.id === 'local' || m.id === '0') m.id = 'local-' + Date.now();
    saveMatch(m);
    console.log(`✔ Катка ${m.id} (${m.hero}) збережена — відкривай http://localhost:${PORT}`);
    try {
      const r = await buildReport(m);
      m.summary = { score: r.score, grade: r.grade };
      saveMatch(m);
    } catch (e) { console.warn('Аналіз не вдався:', e.message); }
  },
});

function summaryOf(m) {
  return {
    id: m.id, hero: m.hero, win: m.win, durationSec: m.durationSec, createdAt: m.createdAt, source: m.source,
    kda: `${m.final?.kills ?? 0}/${m.final?.deaths ?? 0}/${m.final?.assists ?? 0}`,
    grade: m.summary?.grade || null, score: m.summary?.score ?? null,
  };
}

// ---------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (req.method === 'POST' && p === '/gsi') {
      const data = await body(req);
      res.writeHead(200); res.end('ok');
      if (data?.auth?.token !== TOKEN) return;
      session.ingest(data);
      return;
    }

    if (p === '/api/live') return send(res, 200, session.live());
    if (p === '/api/settings' && req.method === 'GET') return send(res, 200, settings());
    if (p === '/api/settings' && req.method === 'POST') { saveSettings(await body(req)); return send(res, 200, settings()); }

    if (p === '/api/matches') {
      const list = fs.readdirSync(MATCHES).filter((f) => f.endsWith('.json'))
        .map((f) => readJson(path.join(MATCHES, f), null)).filter(Boolean)
        .map(summaryOf).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return send(res, 200, list);
    }

    if (p === '/api/finish' && req.method === 'POST') { session.finish('manual'); return send(res, 200, { ok: true }); }

    const mm = p.match(/^\/api\/match\/([\w-]+)$/);
    if (mm) {
      const m = loadMatch(mm[1]);
      if (!m) return send(res, 404, { error: 'Катку не знайдено' });
      if (req.method === 'DELETE') { fs.unlinkSync(matchFile(m.id)); return send(res, 200, { ok: true }); }
      if (req.method === 'POST') { // зміна ролі
        const b = await body(req);
        if (b.role) m.role = b.role;
      }
      const report = await buildReport(m);
      m.summary = { score: report.score, grade: report.grade };
      saveMatch(m);
      return send(res, 200, { match: summaryOf(m), model: { ...m, timeline: undefined }, report });
    }

    if (p === '/api/import' && req.method === 'POST') {
      const b = await body(req);
      const matchId = String(b.matchId || '').trim();
      if (!/^\d{6,12}$/.test(matchId)) return send(res, 400, { error: 'Невірний Match ID — це число на кшталт 7891234567' });
      const existing = loadMatch(matchId);
      const accountId = b.accountId || settings().accountId;
      const odm = await od.importMatch(matchId, { accountId, slot: b.slot, heroName: existing?.hero });
      if (odm.needPick) return send(res, 200, odm);
      const merged = existing && existing.source === 'gsi' ? od.merge(existing, odm) : { ...odm, role: existing?.role };
      const rep = await buildReport(merged);
      merged.summary = { score: rep.score, grade: rep.grade };
      saveMatch(merged);
      if (!odm.parsed) od.requestParse(matchId).catch(() => {});
      return send(res, 200, { id: merged.id, parsed: odm.parsed });
    }

    // ---------- статика
    let file = path.join(ROOT, 'public', p === '/' ? 'index.html' : p);
    if (!file.startsWith(path.join(ROOT, 'public'))) return send(res, 403, { error: 'no' });
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ██ DOTA COACH ██');
  console.log(`  Інтерфейс:  http://localhost:${PORT}`);
  console.log('  Чекаю на дані з Dota 2... (не закривай це вікно під час гри)');
  console.log('');
});

module.exports = { TOKEN };

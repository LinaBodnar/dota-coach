// Робота з публічним API OpenDota: довідники героїв/предметів, бенчмарки по героях,
// імпорт уже зіграної катки за Match ID.
const https = require('https');
const fs = require('fs');
const path = require('path');

const API = 'https://api.opendota.com/api';
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function request(method, url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { 'User-Agent': 'dota-coach-local/1.0' }, timeout: 20000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`OpenDota ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('OpenDota повернув не JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('OpenDota не відповідає (таймаут)')));
    req.on('error', reject);
    req.end();
  });
}

async function cached(name, url, maxAgeH) {
  const file = path.join(CACHE_DIR, name + '.json');
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < maxAgeH * 3600e3) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  try {
    const data = await request('GET', url);
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
  } catch (e) {
    // офлайн — віддаємо старий кеш, якщо є
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    throw e;
  }
}

let heroesCache = null, itemsCache = null;

async function heroes() {
  if (heroesCache) return heroesCache;
  const raw = await cached('heroes', `${API}/constants/heroes`, 24 * 7);
  const byId = {}, byName = {};
  for (const h of Object.values(raw)) {
    const short = h.name.replace('npc_dota_hero_', '');
    const v = { id: h.id, name: short, localized: h.localized_name, roles: h.roles || [], attr: h.primary_attr };
    byId[h.id] = v; byName[short] = v;
  }
  return (heroesCache = { byId, byName });
}

async function items() {
  if (itemsCache) return itemsCache;
  const raw = await cached('items', `${API}/constants/items`, 24 * 7);
  const byKey = {}, byId = {};
  for (const [key, it] of Object.entries(raw)) {
    const v = { key, id: it.id, cost: it.cost || 0, name: it.dname || key, components: it.components || null };
    byKey[key] = v; if (it.id != null) byId[it.id] = v;
  }
  return (itemsCache = { byKey, byId });
}

async function safe(fn, fallback) { try { return await fn(); } catch { return fallback; } }

async function benchmarks(heroId) {
  if (!heroId) return null;
  const raw = await cached('bench_' + heroId, `${API}/benchmarks?hero_id=${heroId}`, 24 * 3);
  return raw && raw.result ? raw.result : null;
}

async function requestParse(matchId) {
  return request('POST', `${API}/request/${matchId}`);
}

// Визначення позиції: лайн з OpenDota + місце в команді за нетворсом
function guessRole(p, team) {
  const sorted = [...team].sort((a, b) => (b.net_worth || b.total_gold || 0) - (a.net_worth || a.total_gold || 0));
  const rank = sorted.indexOf(p) + 1;
  if (p.lane_role === 2 && rank <= 3) return 'mid';
  if (rank <= 3) {
    if (p.lane_role === 1) return 'carry';
    if (p.lane_role === 3) return 'offlane';
    return rank === 1 ? 'carry' : rank === 2 ? 'mid' : 'offlane';
  }
  if (rank === 4) return 'support';
  return 'hardsupport';
}

async function importMatch(matchId, { accountId, heroName, slot } = {}) {
  const m = await request('GET', `${API}/matches/${matchId}`);
  if (!m || !m.players) throw new Error('Катку не знайдено на OpenDota');
  const H = await heroes();
  const I = await safe(items, { byKey: {}, byId: {} });

  const players = m.players.map((p) => ({ ...p, _hero: H.byId[p.hero_id] }));
  let me = null;
  if (slot != null) me = players.find((p) => String(p.player_slot) === String(slot));
  if (!me && accountId) me = players.find((p) => String(p.account_id) === String(accountId));
  if (!me && heroName) me = players.find((p) => p._hero && p._hero.name === heroName);
  if (!me) {
    return {
      needPick: true,
      players: players.map((p) => ({
        slot: p.player_slot, hero: p._hero?.name, heroName: p._hero?.localized,
        name: p.personaname || 'Анонім', radiant: p.isRadiant,
      })),
    };
  }

  const team = players.filter((p) => p.isRadiant === me.isRadiant);
  const teamKills = team.reduce((s, p) => s + (p.kills || 0), 0);
  const heroFull = 'npc_dota_hero_' + (me._hero?.name || '');

  // таймлайн (поминутно) — є тільки в розпаршених катках
  const timeline = [];
  if (Array.isArray(me.lh_t)) {
    for (let i = 0; i < me.lh_t.length; i++) {
      timeline.push({ t: i * 60, lh: me.lh_t[i], dn: me.dn_t?.[i] ?? null, nw: me.gold_t?.[i] ?? null, xp: me.xp_t?.[i] ?? null });
    }
  }

  // смерті: шукаємо себе в kills_log усіх суперників
  const deaths = [];
  for (const p of players) {
    for (const k of p.kills_log || []) {
      if (k.key === heroFull) deaths.push({ t: k.time, killer: p._hero?.name });
    }
  }
  deaths.sort((a, b) => a.t - b.t);

  const itemTimings = (me.purchase_log || [])
    .filter((x) => x.time > 0)
    .map((x) => ({ t: x.time, item: x.key }));
  const startItems = (me.purchase_log || []).filter((x) => x.time <= 0).map((x) => x.key);
  const finalItems = [0, 1, 2, 3, 4, 5].map((i) => I.byId[me['item_' + i]]?.key).filter(Boolean);

  const odPct = {};
  for (const [k, v] of Object.entries(me.benchmarks || {})) if (v && v.pct != null) odPct[k] = v.pct;

  return {
    id: String(m.match_id),
    source: 'opendota',
    createdAt: new Date((m.start_time || Date.now() / 1000) * 1000).toISOString(),
    hero: me._hero?.name || 'unknown',
    team: me.isRadiant ? 'radiant' : 'dire',
    accountId: me.account_id ? String(me.account_id) : null,
    playerName: me.personaname || null,
    win: m.radiant_win === me.isRadiant,
    durationSec: m.duration,
    parsed: Array.isArray(me.lh_t),
    autoRole: guessRole(me, team),
    timeline,
    deaths,
    itemTimings,
    startItems,
    finalItems,
    unspent: [],
    odPct,
    final: {
      kills: me.kills, deaths: me.deaths, assists: me.assists,
      lastHits: me.last_hits, denies: me.denies, gpm: me.gold_per_min, xpm: me.xp_per_min,
      level: me.level, netWorth: me.net_worth, heroDamage: me.hero_damage, towerDamage: me.tower_damage,
      heroHealing: me.hero_healing, obsPlaced: me.obs_placed ?? null, senPlaced: me.sen_placed ?? null,
      stuns: me.stuns ?? null, campsStacked: me.camps_stacked ?? null,
      teamfight: me.teamfight_participation ?? null, laneEff: me.lane_efficiency ?? null,
      killParticipation: teamKills ? (me.kills + me.assists) / teamKills : null,
      apm: me.actions_per_min ?? null,
    },
  };
}

// Об'єднуємо запис з гри (GSI) з даними OpenDota: беремо найкраще з обох
function merge(gsi, od) {
  return {
    ...od,
    source: 'gsi+opendota',
    createdAt: gsi.createdAt,
    deaths: gsi.deaths.length >= od.deaths.length ? gsi.deaths : od.deaths,
    unspent: gsi.unspent,
    timeline: od.timeline.length ? od.timeline : gsi.timeline,
    final: { ...gsi.final, ...Object.fromEntries(Object.entries(od.final).filter(([, v]) => v != null)) },
    role: gsi.role,
  };
}

module.exports = { heroes, items, benchmarks, importMatch, requestParse, merge, safe };

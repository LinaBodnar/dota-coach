// Робота з публічним API OpenDota (для локального сервера): довідники героїв/предметів,
// бенчмарки по героях, імпорт уже зіграної катки за Match ID.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { heroMaps, itemMaps, normalizeMatch, merge } = require('./normalize');

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
  return heroesCache || (heroesCache = heroMaps(await cached('heroes', `${API}/constants/heroes`, 24 * 7)));
}
async function items() {
  return itemsCache || (itemsCache = itemMaps(await cached('items', `${API}/constants/items`, 24 * 7)));
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

async function importMatch(matchId, opts = {}) {
  const m = await request('GET', `${API}/matches/${matchId}`);
  const H = await heroes();
  const I = await safe(items, null);
  return normalizeMatch(m, H, I, opts);
}

module.exports = { heroes, items, benchmarks, importMatch, requestParse, merge, safe };

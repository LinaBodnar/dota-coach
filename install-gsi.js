// Знаходить Dota 2 через Steam і кладе файл конфігу Game State Integration.
// Запуск: node install-gsi.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TOKEN = 'dotacoach_local_9f3k';
const PORT = Number(process.env.PORT) || 3000;
const CFG = `"Dota Coach"
{
  "uri"        "http://127.0.0.1:${PORT}/gsi"
  "timeout"    "5.0"
  "buffer"     "0.1"
  "throttle"   "0.5"
  "heartbeat"  "10.0"
  "data"
  {
    "provider"   "1"
    "map"        "1"
    "player"     "1"
    "hero"       "1"
    "abilities"  "1"
    "items"      "1"
  }
  "auth"
  {
    "token"      "${TOKEN}"
  }
}
`;

function steamRoots() {
  const roots = new Set();
  for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
    try {
      const out = execSync(`reg query "${key}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/(SteamPath|InstallPath)\s+REG_SZ\s+(.+)/g) || [];
      m.forEach((l) => roots.add(l.split(/REG_SZ/)[1].trim().replace(/\//g, '\\')));
    } catch {}
  }
  ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'E:\\Steam', 'D:\\SteamLibrary', 'E:\\SteamLibrary'].forEach((p) => roots.add(p));
  return [...roots];
}

function libraries() {
  const libs = new Set();
  for (const root of steamRoots()) {
    if (!fs.existsSync(root)) continue;
    libs.add(root);
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      const txt = fs.readFileSync(vdf, 'utf8');
      for (const m of txt.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch {}
  }
  return [...libs];
}

function findDota() {
  for (const lib of libraries()) {
    const p = path.join(lib, 'steamapps', 'common', 'dota 2 beta', 'game', 'dota');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const dota = process.argv[2] ? path.join(process.argv[2]) : findDota();
if (!dota || !fs.existsSync(dota)) {
  console.log('\n  ⚠  Не знайшов Dota 2 автоматично.');
  console.log('     Скопіюй файл gamestate_integration_dotacoach.cfg (лежить поруч) вручну в:');
  console.log('     <папка Steam>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\');
  console.log('     або запусти: node install-gsi.js "D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game\\dota"\n');
  fs.writeFileSync(path.join(__dirname, 'gamestate_integration_dotacoach.cfg'), CFG);
  process.exitCode = 1;
} else {
  const dir = path.join(dota, 'cfg', 'gamestate_integration');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'gamestate_integration_dotacoach.cfg');
  fs.writeFileSync(file, CFG);
  console.log('\n  ✔ Конфіг встановлено:', file);
  console.log('  ➜ Не забудь у Steam додати параметр запуску Доти:  -gamestateintegration');
  console.log('    (Steam → Бібліотека → Dota 2 → ПКМ → Властивості → Параметри запуску)\n');
}

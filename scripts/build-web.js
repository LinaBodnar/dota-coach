// Збирає веб-версію (для Vercel) у папку dist-web.
//   node scripts/build-web.js          — тільки зібрати
//   node scripts/build-web.js --serve  — зібрати і відкрити на http://localhost:3001
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-web');
const FILES = {
  'index.html': 'web/index.html',
  'web.js': 'web/web.js',
  'report.js': 'public/report.js',
  'style.css': 'public/style.css',
  'analyzer.js': 'src/analyzer.js',
  'normalize.js': 'src/normalize.js',
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const [to, from] of Object.entries(FILES)) fs.copyFileSync(path.join(ROOT, from), path.join(OUT, to));
console.log('✔ Веб-версія зібрана в dist-web/');

if (process.argv.includes('--serve')) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const PORT = Number(process.env.PORT) || 3001;
  http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const file = path.join(OUT, p === '/' ? 'index.html' : path.basename(p));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  }).listen(PORT, () => console.log(`  http://localhost:${PORT}`));
}

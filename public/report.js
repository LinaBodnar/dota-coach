// ===== Спільний код звіту (локальна і веб-версія)
const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react';
const heroImg = (h) => `${CDN}/heroes/${h}.png`;
const itemImg = (i) => `${CDN}/items/${i}.png`;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = (s) => { s = Math.round(s || 0); const neg = s < 0; s = Math.abs(s); return `${neg ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const pretty = (s) => (s || '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); }

function ring(score, grade) {
  const r = 64, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  const col = { S: '#ffd166', A: '#34d399', B: '#60a5fa', C: '#fbbf24', D: '#f87171' }[grade];
  return `<div class="ring"><svg width="150" height="150"><circle cx="75" cy="75" r="${r}" fill="none" stroke="#232c3e" stroke-width="10"/>
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" style="transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 8px ${col}66)" data-off="${off}"/></svg>
    <div class="in"><div><div class="letter g-${grade}">${grade}</div><div class="num">${score} / 100</div></div></div></div>`;
}

// h: { onRole(role), onRefresh(btn), refreshLabel, onDelete() }
function renderReport({ model, report: R }, h = {}) {
  const res = model.win === true ? ['win', 'ПЕРЕМОГА'] : model.win === false ? ['loss', 'ПОРАЗКА'] : ['na', 'БЕЗ РЕЗУЛЬТАТУ'];
  const srcLabel = { gsi: 'записано з гри', opendota: 'OpenDota', 'gsi+opendota': 'гра + OpenDota' }[model.source] || model.source;
  if (h.onDelete === undefined) h.onDelete = async () => {};
  const benchLabel = { 'opendota-match': 'порівняння з гравцями на цьому герої (OpenDota)', 'opendota-hero': 'порівняння з гравцями на цьому герої (OpenDota)', 'role-table': 'порівняння з нормами для ролі' }[R.benchSource];

  const metricHtml = R.metrics.map((m) => `
    <div class="metric ${m.rating}" title="${esc(m.hint || '')}">
      <span class="tag">${{ good: 'чотко', ok: 'норм', bad: 'слабо' }[m.rating]}</span>
      <div class="l">${esc(m.label)}</div>
      <div class="v">${esc(m.display)}</div>
      <div class="bar"><i style="width:${Math.max(4, Math.round(m.s * 100))}%"></i></div>
      <div class="f"><span>${m.pct != null ? `краще за ${m.pct}%` : ''}</span><span>${m.target ? 'ціль ' + esc(m.target) : ''}</span></div>
    </div>`).join('');

  const list = (arr, empty) => arr.length ? arr.map((x) => `<div class="fi"><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div>`).join('') : `<div class="none">${empty}</div>`;
  const tipsHtml = R.tips.map((x, i) => `<div class="fi tipi"><div class="n">${i + 1}</div><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div></div>`).join('');

  const dur = R.durationSec;
  const ticks = []; for (let t = 0; t <= dur; t += dur > 2700 ? 600 : 300) ticks.push(t);
  const deathsHtml = R.deaths.length ? `
    <div class="strip"><div class="track"></div>
      ${ticks.map((t) => `<div class="tick" style="left:${(t / dur) * 100}%">${mmss(t)}</div>`).join('')}
      ${R.deaths.map((d) => `<div class="skull ${d.notes.length ? 'warn' : ''}" style="left:${Math.min(100, (d.t / dur) * 100)}%" title="${mmss(d.t)}${d.notes.length ? ' — ' + esc(d.notes.join(', ')) : ''}">☠</div>`).join('')}
    </div>
    <div class="dlist">${R.deaths.map((d) => `<div class="dchip"><b>${mmss(d.t)}</b>${d.killer ? 'від ' + esc(pretty(d.killer)) : ''}${d.notes.length ? ` <em>${esc(d.notes.join(' · '))}</em>` : ''}${d.respawn ? ` <span style="color:var(--dim)">· ${d.respawn}с респ</span>` : ''}</div>`).join('')}</div>`
    : '<div class="none">Жодної смерті. Красава.</div>';

  const phasesHtml = R.phases.map((p) => `<div class="phase"><div class="pn">${p.name}</div><div class="pt">${mmss(p.from)} – ${mmss(p.to)}</div>
      ${p.lpm != null ? `<div class="row"><span>Ластхіти/хв</span><b>${p.lpm.toFixed(1)}</b></div>` : ''}
      <div class="row"><span>Смерті</span><b style="color:${p.deaths >= 3 ? 'var(--bad)' : p.deaths === 0 ? 'var(--good)' : 'inherit'}">${p.deaths}</b></div></div>`).join('');

  const shownItems = R.items.filter((x) => x.major || x.cost == null || x.cost >= 900);
  const itemsHtml = shownItems.length ? `<div class="items">${shownItems.map((x) => `<div class="it ${x.major ? 'major' : ''}" title="${esc(x.name)}"><img src="${itemImg(x.item)}" alt="${esc(x.name)}" onerror="this.style.opacity=.25"><span>${mmss(x.t)}</span></div>`).join('')}</div>` : '<div class="none">Немає даних про покупки.</div>';
  const finalHtml = R.finalItems.length ? `<div style="font-size:12px;color:var(--muted);margin:16px 0 8px">Фінальний інвентар</div><div class="items">${R.finalItems.map((x) => `<div class="it" title="${esc(x.name)}"><img src="${itemImg(x.item)}" alt="${esc(x.name)}" onerror="this.style.opacity=.25"></div>`).join('')}</div>` : '';

  let goldSrc = '';
  if (R.goldSources) {
    const cols = ['#f0b44c', '#e5483f', '#60a5fa', '#a78bfa'];
    const entries = Object.entries(R.goldSources).filter(([, v]) => v > 0);
    const tot = entries.reduce((s, [, v]) => s + v, 0) || 1;
    goldSrc = `<div class="mt"><div style="font-size:12px;color:var(--muted)">Звідки золото</div>
      <div class="gsrc">${entries.map(([k, v], i) => `<i style="width:${(v / tot) * 100}%;background:${cols[i]}" title="${k}"></i>`).join('')}</div>
      <div class="gleg">${entries.map(([k, v], i) => `<span><i style="background:${cols[i]}"></i>${k} <b>${Math.round((v / tot) * 100)}%</b></span>`).join('')}</div></div>`;
  }

  $('#main').innerHTML = `
  <div class="fade">
    <section class="hero"><div class="hero-bg" style="background-image:url(${heroImg(model.hero)})"></div>
      <div class="hero-in">
        <div class="hero-main">
          <div class="result ${res[0]}">${res[1]}</div>
          <div class="hero-name">${esc(R.heroName)}</div>
          <div class="hero-meta">
            <span>KDA <b>${model.final.kills}/${model.final.deaths}/${model.final.assists}</b></span>
            <span>Тривалість <b>${mmss(model.durationSec)}</b></span>
            <span>LH/DN <b>${model.final.lastHits}/${model.final.denies}</b></span>
            ${R.apm ? `<span>APM <b>${R.apm}</b></span>` : ''}
            <span>Матч <b>${esc(model.id)}</b></span>
          </div>
          <div class="verdict">${esc(R.verdict)}</div>
          <div class="role-pick"><span>Роль:</span>
            ${Object.entries(R.roles).map(([k, v]) => `<button class="pill ${k === R.role ? 'on' : ''}" data-role="${k}">${v}</button>`).join('')}
            ${R.roleAuto ? '<span class="auto-note">визначено автоматично — клікни, якщо не так</span>' : ''}
          </div>
        </div>
        ${ring(R.score, R.grade)}
      </div>
    </section>

    ${R.focus.length ? `<div class="focus mt"><span class="t">Фокус на наступну катку</span>${R.focus.map((f) => `<span class="f">${esc(f)}</span>`).join('')}</div>` : ''}

    <div class="grid cols3 mt">
      <div class="card col good"><h3><span class="ic">✓</span>Що чотко</h3>${list(R.good, 'Цього разу без явних плюсів — буває.')}</div>
      <div class="card col bad"><h3><span class="ic">✕</span>Що не дуже</h3>${list(R.bad, 'Серйозних проблем не знайдено 👌')}</div>
      <div class="card col tip"><h3><span class="ic">➜</span>Що поміняти</h3>${tipsHtml}</div>
    </div>

    <div class="card mt"><h3>Показники <span class="sub">${esc(benchLabel)}</span></h3><div class="grid metrics">${metricHtml}</div></div>

    <div class="grid cols2 mt">
      <div class="card"><h3>Ластхіти по часу</h3><div id="chLh"></div></div>
      <div class="card"><h3>${esc(R.charts.goldLabel)}</h3><div id="chGold"></div>${goldSrc}</div>
    </div>

    <div class="card mt"><h3>Смерті <span class="sub">${R.deaths.length} за катку · жовті — з помилкою</span></h3>${deathsHtml}</div>

    ${R.phases.length ? `<div class="card mt"><h3>По фазах гри</h3><div class="grid phases">${phasesHtml}</div></div>` : ''}

    <div class="card mt"><h3>Предмети <span class="sub">золота рамка — великі предмети</span></h3>${itemsHtml}${finalHtml}</div>

    <div class="actions">
      ${h.onRefresh ? `<button class="btn btn-ghost" id="enrich">${esc(h.refreshLabel || 'Оновити з OpenDota')}</button>` : ''}
      <button class="btn btn-ghost" id="del">Видалити катку</button>
    </div>
    <div class="foot-note">Джерело даних: ${esc(srcLabel)}${model.source === 'opendota' && !model.parsed ? ' · катка ще не розпаршена OpenDota — графіки з\'являться після парсу (запит уже відправлено, спробуй «Оновити» за пару хвилин)' : ''}</div>
  </div>`;

  requestAnimationFrame(() => document.querySelectorAll('.ring circle[data-off]').forEach((c) => c.style.strokeDashoffset = c.dataset.off));
  document.querySelectorAll('.pill[data-role]').forEach((b) => b.onclick = () => h.onRole && h.onRole(b.dataset.role));

  const lhSeries = [{ name: 'Твої ластхіти', color: '#ff6a4d', points: R.charts.lh, area: true }];
  if (R.charts.lhTarget) lhSeries.push({ name: 'Ціль для ролі', color: '#8892a8', points: R.charts.lhTarget, dashed: true });
  lineChart($('#chLh'), lhSeries, dur);
  lineChart($('#chGold'), [{ name: R.charts.goldLabel, color: '#f0b44c', points: R.charts.gold, area: true }], dur);

  const en = $('#enrich');
  if (en) en.onclick = () => h.onRefresh(en);
  $('#del').onclick = async () => {
    if (!confirm('Видалити цю катку з історії?')) return;
    await h.onDelete();
  };
}

// ================= графік (чистий SVG)
function lineChart(el, series, dur) {
  const pts = series.flatMap((s) => s.points);
  if (pts.length < 2) { el.innerHTML = '<div class="none">Недостатньо даних для графіка.</div>'; return; }
  const W = 560, H = 230, P = { l: 44, r: 12, t: 12, b: 26 };
  const maxT = Math.max(dur || 0, ...pts.map((p) => p.t));
  const maxV = Math.max(...pts.map((p) => p.v)) * 1.08 || 1;
  const x = (t) => P.l + (t / maxT) * (W - P.l - P.r);
  const y = (v) => H - P.b - (v / maxV) * (H - P.t - P.b);
  const fmt = (v) => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = (maxV / 4) * i; g += `<line class="gridl" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
  const step = maxT > 2700 ? 600 : 300;
  for (let t = 0; t <= maxT; t += step) g += `<text class="axis" x="${x(t)}" y="${H - 6}" text-anchor="middle">${Math.round(t / 60)}′</text>`;
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  let paths = '';
  series.forEach((s, i) => {
    const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    if (s.area) paths += `<defs><linearGradient id="${id}${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d}L${x(s.points.at(-1).t)},${y(0)}L${x(s.points[0].t)},${y(0)}Z" fill="url(#${id}${i})"/>`;
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.dashed ? 1.6 : 2.6}" ${s.dashed ? 'stroke-dasharray="5 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}">${g}${paths}
    <line class="cursor" y1="${P.t}" y2="${H - P.b}" stroke="#ffffff33" stroke-width="1" style="display:none"/>
    ${series.map((s, i) => `<circle class="cdot" data-i="${i}" r="4.5" fill="${s.color}" stroke="#090b11" stroke-width="2" style="display:none"/>`).join('')}
    <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" class="hit"/></svg><div class="tt"></div></div>
    <div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;

  const svg = el.querySelector('svg'), tt = el.querySelector('.tt'), cur = el.querySelector('.cursor');
  const near = (arr, t) => {
    if (arr.length > 3) return arr.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    // пряма лінія цілі — інтерполюємо
    for (let i = 1; i < arr.length; i++) if (t <= arr[i].t) { const a = arr[i - 1], b = arr[i]; return { t, v: a.v + ((t - a.t) / (b.t - a.t)) * (b.v - a.v) }; }
    return arr.at(-1);
  };
  el.querySelector('.hit').addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r) * maxT;
    const main = near(series[0].points, t);
    cur.style.display = ''; cur.setAttribute('x1', x(main.t)); cur.setAttribute('x2', x(main.t));
    let html = `<b>${mmss(main.t)}</b>`;
    series.forEach((s, i) => {
      const p = near(s.points, main.t); const dot = el.querySelector(`.cdot[data-i="${i}"]`);
      dot.style.display = ''; dot.setAttribute('cx', x(p.t)); dot.setAttribute('cy', y(p.v));
      html += `<br><span style="color:${s.color}">●</span> ${esc(s.name)}: <b>${Math.round(p.v)}</b>`;
    });
    tt.innerHTML = html; tt.style.opacity = 1;
    tt.style.left = (x(main.t) / W) * r.width + 'px'; tt.style.top = (y(main.v) / H) * r.height + 'px';
  });
  el.querySelector('.hit').addEventListener('mouseleave', () => { tt.style.opacity = 0; cur.style.display = 'none'; el.querySelectorAll('.cdot').forEach((d) => d.style.display = 'none'); });
}

function showPick(players, onPick) {
  const team = (rad) => players.filter((p) => p.radiant === rad).map((p) => `<button data-slot="${p.slot}"><img src="${heroImg(p.hero)}" onerror="this.style.visibility='hidden'"><div><b>${esc(p.heroName || pretty(p.hero))}</b><div style="font-size:12px;color:var(--muted)">${esc(p.name)}</div></div></button>`).join('');
  $('#main').innerHTML = `<div class="card fade"><h3>Хто з них ти?</h3><p style="color:var(--muted);margin:0">Не знайшов твій Steam ID у цій катці (або профіль прихований). Обери свого героя:</p>
    <div class="grid cols2 mt"><div><div class="result win">СИЛИ СВІТЛА</div><div class="pick" style="grid-template-columns:1fr">${team(true)}</div></div>
    <div><div class="result loss">СИЛИ ТЕМРЯВИ</div><div class="pick" style="grid-template-columns:1fr">${team(false)}</div></div></div></div>`;
  document.querySelectorAll('.pick button').forEach((b) => b.onclick = () => onPick(b.dataset.slot, b));
}

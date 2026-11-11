// ===== Dota Coach UI (локальна версія). Звіт малює public/report.js
const api = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Помилка');
  return j;
};

const state = { matches: [], current: null, view: 'home', wasInGame: false, live: null };

// ================= список каток
async function loadList() {
  state.matches = await api('/api/matches');
  $('#count').textContent = state.matches.length || '';
  const el = $('#list');
  if (!state.matches.length) { el.innerHTML = '<div class="empty-list">Тут з\'являться твої катки після гри.</div>'; return; }
  el.innerHTML = state.matches.map((m) => `
    <div class="mi ${m.win === true ? 'win' : m.win === false ? 'loss' : ''} ${state.current === m.id ? 'active' : ''}" data-id="${esc(m.id)}">
      <img src="${heroImg(m.hero)}" alt="" onerror="this.style.visibility='hidden'">
      <div class="info">
        <div class="h">${esc(pretty(m.hero))}</div>
        <div class="s">${esc(m.kda)} · ${mmss(m.durationSec)} · ${new Date(m.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}</div>
      </div>
      <div class="gbadge g-${m.grade || ''}">${m.grade || '–'}</div>
    </div>`).join('');
  el.querySelectorAll('.mi').forEach((n) => n.onclick = () => openMatch(n.dataset.id));
}

// ================= головний екран
function renderHome() {
  state.view = 'home'; state.current = null; history.replaceState(null, '', location.pathname); loadList();
  $('#main').innerHTML = `
  <div class="welcome fade">
    <div class="result na">ТВІЙ ПЕРСОНАЛЬНИЙ АНАЛІТИК</div>
    <h1>Зіграв катку — <span>отримав розбір.</span></h1>
    <p class="lead">Dota Coach слухає гру через офіційну Game State Integration від Valve, а після кінця катки показує оцінку, сильні та слабкі сторони і конкретні поради, що поміняти.</p>
    <div class="grid steps">
      <div class="card step"><div class="num">01</div><b>Запусти коуча</b><p>Двічі клікни <code>start.bat</code>. Він сам поставить конфіг у папку Доти і відкриє цю сторінку.</p></div>
      <div class="card step"><div class="num">02</div><b>Параметр запуску</b><p>Steam → Dota 2 → Властивості → Параметри запуску: додай <code>-gamestateintegration</code></p></div>
      <div class="card step"><div class="num">03</div><b>Грай</b><p>Під час катки зверху світиться <span style="color:var(--red2);font-weight:700">LIVE</span>. Після трона розбір відкриється сам.</p></div>
    </div>
    <div class="card mt"><h3>Або розбери стару катку</h3><p style="margin:0;color:var(--muted)">Встав Match ID зліва (його видно в історії матчів у Доті, на Dotabuff або OpenDota) і натисни <b>Аналіз</b>. Щоб коуч знав, хто з 10 гравців — ти, впиши свій Steam ID внизу зліва (або він сам підтягнеться після першої гри з коучем).</p></div>
  </div>`;
}

// ================= live
function renderLive() {
  state.view = 'live'; state.current = null; state.liveDrawn = false; loadList();
  drawLive();
}
function drawLive() {
  const L = state.live;
  if (state.view !== 'live') return;
  if (!L || !L.inGame) { $('#main').innerHTML = '<div class="loading"><div><div class="spin"></div>Катка ще не почалась…</div></div>'; return; }
  const F = L.final || {}, min = Math.max(1, L.t / 60);
  const tips = [];
  if (!L.hasTp && L.t > 120) tips.push(['🌀', 'Нема ТП в інвентарі', 'Купи ТП-скрол — 100 голди, які можуть врятувати життя.']);
  if (L.gold >= 2000) tips.push(['💰', `${L.gold} голди на руках`, 'Витрать гроші: купи наступний компонент і відправ кур\'єром.']);
  if (L.t >= 300 && L.t <= 660 && F.lastHits != null) {
    const pace = Math.round(F.lastHits / min * 10);
    tips.push(['🗡️', `Темп: ~${pace} ластхітів на 10 хв`, pace >= 50 ? 'Чотко, тримай!' : 'Сконцентруйся на добиванні — це основа фарму.']);
  }
  if (L.deaths >= 3 && L.t < 600) tips.push(['💀', 'Багато смертей на лайні', 'Відійди ближче до тавери, грай від хілок і чекай на ганг від своїх.']);
  if (!tips.length) tips.push(['✅', 'Все під контролем', 'Продовжуй у тому ж дусі. Розбір буде після кінця катки.']);

  $('#main').innerHTML = `
  <div class="live ${state.liveDrawn ? '' : 'fade'}">
    <div class="hero"><div class="hero-bg" style="background-image:url(${heroImg(L.hero)})"></div>
      <div class="hero-in"><div class="hero-main">
        <div class="result loss" style="background:rgba(229,72,63,.18);color:var(--red2)">● LIVE</div>
        <div class="hero-name">${esc(pretty(L.hero))}</div>
        <div class="big">${mmss(L.t)}</div>
      </div></div>
    </div>
    <div class="grid live-grid mt">
      ${[['KDA', `${F.kills}/${F.deaths}/${F.assists}`], ['Ластхіти / денаї', `${F.lastHits} / ${F.denies}`], ['GPM', F.gpm], ['XPM', F.xpm], ['Рівень', F.level], ['Золото', L.gold]]
        .map(([l, v]) => `<div class="lstat"><div class="l">${l}</div><div class="v">${esc(v ?? '–')}</div></div>`).join('')}
    </div>
    <div class="card mt ltips"><h3>Підказки прямо зараз</h3>
      ${tips.map(([i, t, p]) => `<div class="fi"><div style="font-size:20px">${i}</div><div><b>${esc(t)}</b><p>${esc(p)}</p></div></div>`).join('')}
    </div>
    <div class="actions"><button class="btn btn-ghost" id="finishNow">Завершити запис і проаналізувати зараз</button></div>
  </div>`;
  state.liveDrawn = true;
  $('#finishNow').onclick = async () => { await api('/api/finish', { method: 'POST' }); toast('Аналізую…'); setTimeout(openLatest, 800); };
}

// ================= звіт
async function openMatch(id, role) {
  state.view = 'match'; state.current = id; history.replaceState(null, '', '#' + id);
  document.querySelectorAll('.mi').forEach((n) => n.classList.toggle('active', n.dataset.id === id));
  if (!role) $('#main').innerHTML = '<div class="loading"><div><div class="spin"></div>Аналізую катку…</div></div>';
  try {
    const data = role ? await api(`/api/match/${id}`, { method: 'POST', body: JSON.stringify({ role }) }) : await api(`/api/match/${id}`);
    renderReport(data, {
      onRole: (r) => openMatch(id, r),
      ...(/^\d+$/.test(id) ? { refreshLabel: data.model.source === 'gsi' ? 'Доповнити даними OpenDota' : 'Оновити з OpenDota', onRefresh: (btn) => importMatch(id, null, btn) } : {}),
      onDelete: async () => { await api(`/api/match/${id}`, { method: 'DELETE' }); toast('Видалено'); renderHome(); },
    });
    loadList();
  } catch (e) { $('#main').innerHTML = `<div class="card">Не вдалося відкрити катку: ${esc(e.message)}</div>`; }
}
async function openLatest() { await loadList(); if (state.matches[0]) openMatch(state.matches[0].id); }

// ================= імпорт з OpenDota
async function importMatch(matchId, slot, btn) {
  btn = btn || $('#importBtn');
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Завантажую…';
  try {
    const r = await api('/api/import', { method: 'POST', body: JSON.stringify({ matchId, slot, accountId: $('#accountInput').value.trim() || undefined }) });
    if (r.needPick) { state.view = 'pick'; return showPick(r.players, (slot, b) => importMatch(matchId, slot, b)); }
    if (!r.parsed) toast('Катку завантажено. Детальний парс OpenDota ще в черзі — графіки з\'являться пізніше.');
    await loadList(); openMatch(r.id);
  } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = old; }
}

// ================= статус / live
async function poll() {
  try {
    const L = await api('/api/live');
    state.live = L;
    $('#status').classList.toggle('on', L.connected);
    $('#statusText').textContent = L.connected ? (L.inGame ? 'Запис катки' : 'Дота підключена') : 'Чекаю на Доту…';
    $('#liveChip').classList.toggle('hidden', !L.inGame);
    if (L.inGame) $('#liveClock').textContent = mmss(L.t);
    if (L.inGame && !state.wasInGame && state.view === 'home') renderLive();
    if (state.view === 'live') drawLive();
    if (!L.inGame && state.wasInGame) { toast('Катка закінчилась — ось твій розбір 👇'); setTimeout(openLatest, 1500); }
    state.wasInGame = L.inGame;
  } catch { $('#status').classList.remove('on'); $('#statusText').textContent = 'Сервер вимкнено'; }
}

// ================= init
$('#home').onclick = (e) => { e.preventDefault(); renderHome(); };
$('#liveChip').onclick = renderLive;
$('#importForm').onsubmit = (e) => { e.preventDefault(); const v = $('#matchIdInput').value.trim(); if (v) importMatch(v); };
$('#accountInput').onchange = async (e) => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ accountId: e.target.value.trim() }) }); toast('Steam ID збережено'); };
api('/api/settings').then((s) => { if (s.accountId) $('#accountInput').value = s.accountId; });

const startId = location.hash.slice(1);
if (startId) openMatch(startId); else renderHome();
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.current) openMatch(id); });
poll(); setInterval(poll, 2000);

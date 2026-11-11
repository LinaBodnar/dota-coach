// ===== Dota Coach — веб-версія. Усе працює в браузері: дані з OpenDota, аналіз тут же,
// розібрані катки зберігаються в localStorage цього браузера.
const OD = 'https://api.opendota.com/api';
const STEAM64 = 76561197960265728n;

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const store = {
  all() { return LS.get('dc.matches', {}); },
  get(id) { return this.all()[id] || null; },
  put(m) {
    const all = this.all(); all[m.id] = m;
    // якщо місце скінчилось — викидаємо найстаріші
    const ids = Object.keys(all).sort((a, b) => (all[a].createdAt || '').localeCompare(all[b].createdAt || ''));
    while (!LS.set('dc.matches', all) && ids.length > 1) delete all[ids.shift()];
  },
  del(id) { const all = this.all(); delete all[id]; LS.set('dc.matches', all); },
};

const state = { view: 'home', current: null, recent: null, recentFor: null };

// ---------- OpenDota
async function odGet(path) {
  let r;
  try { r = await fetch(OD + path); } catch { throw new Error('Не вдалося достукатись до OpenDota — перевір інтернет'); }
  if (r.status === 404) throw new Error('Не знайдено на OpenDota');
  if (r.status === 429) throw new Error('OpenDota просить зачекати хвилинку (ліміт запитів)');
  if (!r.ok) throw new Error('OpenDota відповів помилкою ' + r.status);
  return r.json();
}

const mem = {};
async function cachedGet(key, path, maxAgeH, storage = localStorage) {
  if (mem[key]) return mem[key];
  try {
    const c = JSON.parse(storage.getItem(key) || 'null');
    if (c && Date.now() - c.at < maxAgeH * 3600e3) return (mem[key] = c.data);
  } catch {}
  const data = await odGet(path);
  try { storage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch {}
  return (mem[key] = data);
}

let H = null, I = null;
async function maps() {
  if (!H) H = CoachData.heroMaps(await cachedGet('dc.heroes', '/constants/heroes', 24 * 7));
  if (!I) {
    try { I = CoachData.itemMaps(await cachedGet('dc.items', '/constants/items', 24 * 7, sessionStorage)); } catch { I = null; }
  }
  return { H, I };
}

async function buildReport(m) {
  const { H, I } = await maps();
  let bench = null;
  if (!m.odPct || !Object.keys(m.odPct).length) {
    const heroId = m.heroId || H.byName[m.hero]?.id;
    if (heroId) bench = await cachedGet('dc.bench.' + heroId, '/benchmarks?hero_id=' + heroId, 24 * 3).then((b) => b.result).catch(() => null);
  }
  return Coach.analyze(m, { role: m.role, heroes: H, items: I, bench });
}

// ---------- парсинг введеного
function parseMatchId(s) {
  const m = String(s).match(/matches\/(\d{6,12})/) || String(s).match(/(\d{6,12})/);
  return m ? m[1] : null;
}
function parseAccountId(s) {
  const nums = String(s).match(/\d{5,20}/g);
  if (!nums) return null;
  let n = BigInt(nums[nums.length - 1]);
  if (n > STEAM64) n -= STEAM64;
  return String(n);
}
const acc = () => LS.get('dc.account', null);
// на телефоні сайдбар зверху — тому прокручуємо одразу до звіту
const toReport = () => (innerWidth < 900 ? $('#main').scrollIntoView({ behavior: 'smooth' }) : window.scrollTo({ top: 0 }));

// ---------- списки в сайдбарі
function itemRow({ id, hero, win, kda, durationSec, createdAt, grade, slot }) {
  return `<div class="mi ${win === true ? 'win' : win === false ? 'loss' : ''} ${state.current === String(id) ? 'active' : ''}" data-id="${esc(id)}" ${slot != null ? `data-slot="${slot}"` : ''}>
    <img src="${heroImg(hero)}" alt="" onerror="this.style.visibility='hidden'">
    <div class="info"><div class="h">${esc(H?.byName[hero]?.localized || pretty(hero))}</div>
      <div class="s">${esc(kda)} · ${mmss(durationSec)} · ${new Date(createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}</div></div>
    <div class="gbadge g-${grade || ''} ${grade ? '' : 'dim'}">${grade || '?'}</div></div>`;
}

function renderSaved() {
  const all = Object.values(store.all()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  $('#count').textContent = all.length || '';
  const el = $('#list');
  el.innerHTML = all.length ? all.map((m) => itemRow({
    id: m.id, hero: m.hero, win: m.win, durationSec: m.durationSec, createdAt: m.createdAt, grade: m.summary?.grade,
    kda: `${m.final.kills}/${m.final.deaths}/${m.final.assists}`,
  })).join('') : '<div class="empty-list">Тут з\'являться катки, які ти розбереш.</div>';
  el.querySelectorAll('.mi').forEach((n) => n.onclick = () => openMatch(n.dataset.id));
}

async function renderRecent(force) {
  const el = $('#recent');
  const a = acc();
  $('#recentTitle').classList.toggle('hidden', !a);
  if (!a) { el.innerHTML = '<div class="hintbox">Впиши свій ID вище — і тут з\'являться твої останні катки, щоб розбирати їх в один клік.</div>'; return; }
  if (force || state.recentFor !== a) {
    el.innerHTML = '<div class="empty-list">Завантажую…</div>';
    try {
      await maps();
      state.recent = await odGet(`/players/${a}/recentMatches`);
      state.recentFor = a;
    } catch (e) { el.innerHTML = `<div class="hintbox">${esc(e.message)}</div>`; return; }
  }
  const saved = store.all();
  if (!state.recent.length) {
    el.innerHTML = '<div class="hintbox">Каток не видно. Найчастіше це прихована статистика: Дота → Налаштування → Соціальне → увімкни «Відкрити дані матчів» і зачекай кілька хвилин.</div>';
    return;
  }
  el.innerHTML = state.recent.slice(0, 20).map((r) => itemRow({
    id: r.match_id, slot: r.player_slot, hero: H.byId[r.hero_id]?.name, win: (r.player_slot < 128) === r.radiant_win,
    durationSec: r.duration, createdAt: new Date(r.start_time * 1000).toISOString(),
    grade: saved[r.match_id]?.slot === r.player_slot ? saved[r.match_id].summary?.grade : null,
    kda: `${r.kills}/${r.deaths}/${r.assists}`,
  })).join('');
  el.querySelectorAll('.mi').forEach((n) => n.onclick = () => (String(saved[n.dataset.id]?.slot) === n.dataset.slot ? openMatch(n.dataset.id) : analyzeMatch(n.dataset.id, n.dataset.slot)));
}

async function renderMe() {
  const a = acc(), el = $('#me');
  if (!a) { el.classList.add('hidden'); return; }
  try {
    const p = await cachedGet('dc.player.' + a, '/players/' + a, 6);
    if (!p.profile) throw 0;
    el.innerHTML = `<img src="${esc(p.profile.avatarmedium)}" alt=""><div><b>${esc(p.profile.personaname)}</b><small>${p.rank_tier ? 'ранг ' + esc(rankName(p.rank_tier)) : 'ID ' + esc(a)}</small></div>`;
    el.classList.remove('hidden');
  } catch { el.innerHTML = `<div><small>Профіль ${esc(a)} не знайдено на OpenDota</small></div>`; el.classList.remove('hidden'); }
}
function rankName(t) {
  const names = ['', 'Рекрут', 'Вартовий', 'Лицар', 'Герой', 'Легенда', 'Пращур', 'Божество', 'Безсмертний'];
  return `${names[Math.floor(t / 10)] || ''} ${t % 10 || ''}`.trim();
}

// ---------- екрани
function renderHome() {
  state.view = 'home'; state.current = null;
  history.replaceState(null, '', location.pathname);
  renderSaved();
  $('#main').innerHTML = `
  <div class="welcome fade">
    <div class="result na">ДАТА-КОУЧ ДЛЯ DOTA 2</div>
    <h1>Зіграв катку — <span>отримав розбір.</span></h1>
    <p class="lead">Оцінка від S до D, що було чотко, що не дуже і конкретні поради, що поміняти. Порівнюємо тебе з тисячами гравців на тому ж герої.</p>
    <div class="grid steps">
      <div class="card step"><div class="num">01</div><b>Впиши свій ID</b><p>Дота → твій профіль → <b style="display:inline;color:var(--text)">Friend ID</b> під ніком. Або встав посилання на свій профіль Steam/Dotabuff.</p></div>
      <div class="card step"><div class="num">02</div><b>Обери катку</b><p>Зліва з'являться твої останні катки. Або просто встав будь-який Match ID чи посилання.</p></div>
      <div class="card step"><div class="num">03</div><b>Читай розбір</b><p>Отримаєш оцінку, графіки, розбір смертей і план на наступну катку.</p></div>
    </div>
    <div class="card mt"><h3>Не бачить твоїх каток?</h3><p style="margin:0;color:var(--muted)">У Доті: Налаштування → Соціальне → увімкни <b style="color:var(--text)">«Відкрити дані матчів»</b> (Expose Public Match Data). Свіжа катка з'являється на OpenDota за кілька хвилин після гри, а детальні графіки — після парсу (ще пару хвилин).</p></div>
    <div class="card mt"><h3>Хочеш ще більше?</h3><p style="margin:0;color:var(--muted)">Є <a href="https://github.com/LinaBodnar/dota-coach" target="_blank" rel="noopener" style="color:var(--red2)">версія для компа</a>: вона слухає гру наживо, показує підказки під час катки (LIVE) і бачить, чи мав ти ТП і скільки золота згоріло при кожній смерті.</p></div>
  </div>`;
}

async function openMatch(id, preReport) {
  const m = store.get(id);
  if (!m) return analyzeMatch(id);
  state.view = 'match'; state.current = String(id);
  history.replaceState(null, '', '#' + id);
  try {
    const R = preReport || (await buildReport(m));
    renderReport({ model: m, report: R }, {
      onRole: (r) => { m.role = r; store.put(m); openMatch(id).then(() => toReport()); },
      refreshLabel: 'Оновити з OpenDota',
      onRefresh: (btn) => analyzeMatch(id, m.slot, btn),
      onDelete: () => { store.del(id); toast('Видалено'); renderHome(); renderRecent(); },
    });
  } catch (e) { $('#main').innerHTML = `<div class="card">Не вдалося зробити розбір: ${esc(e.message)}</div>`; }
  renderSaved(); renderRecent();
}

async function analyzeMatch(matchId, slot, btn) {
  const prev = store.get(matchId);
  if (btn) { btn.disabled = true; btn.dataset.old = btn.textContent; btn.textContent = 'Завантажую…'; }
  if (!btn || !prev) {
    state.view = 'loading'; state.current = String(matchId);
    $('#main').innerHTML = '<div class="loading"><div><div class="spin"></div>Тягну катку з OpenDota і аналізую…</div></div>';
  }
  try {
    const [raw, { H, I }] = await Promise.all([odGet('/matches/' + matchId), maps()]);
    const m = CoachData.normalizeMatch(raw, H, I, { accountId: acc(), slot: slot ?? prev?.slot, heroName: prev?.hero });
    if (m.needPick) {
      state.view = 'pick';
      showPick(m.players, (s, b) => analyzeMatch(matchId, s, b));
      return;
    }
    if (prev?.role) m.role = prev.role;
    if (!m.parsed) {
      fetch(`${OD}/request/${matchId}`, { method: 'POST' }).catch(() => {});
      toast('Детальний парс OpenDota ще в черзі — графіки з\'являться, якщо натиснути «Оновити» за пару хвилин');
    }
    const R = await buildReport(m);
    m.summary = { score: R.score, grade: R.grade };
    store.put(m);
    await openMatch(m.id, R);
    toReport();
  } catch (e) {
    toast(e.message);
    if (!prev) renderHome();
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.old; }
  }
}

// ---------- init
$('#home').onclick = (e) => { e.preventDefault(); renderHome(); };
$('#importForm').onsubmit = (e) => {
  e.preventDefault();
  const id = parseMatchId($('#matchIdInput').value);
  if (!id) return toast('Не бачу тут Match ID — це число на кшталт 7891234567');
  $('#matchIdInput').value = '';
  const prev = store.get(id);
  prev ? openMatch(id) : analyzeMatch(id);
};
$('#accountInput').onchange = (e) => {
  const v = e.target.value.trim();
  const id = v ? parseAccountId(v) : null;
  if (v && !id) return toast('Не схоже на Steam ID');
  LS.set('dc.account', id);
  e.target.value = id || '';
  if (id) toast('ID збережено');
  renderMe(); renderRecent(true);
};
$('#recentReload').onclick = () => renderRecent(true);
$('#accountInput').value = acc() || '';
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.current) openMatch(id); });

const startId = location.hash.slice(1);
if (startId && /^\d+$/.test(startId)) openMatch(startId); else renderHome();
maps().then(() => { renderSaved(); renderRecent(); }).catch(() => renderRecent());
renderMe();

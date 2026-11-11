// "Мозок" коуча: бере запис катки і видає оцінку, що чотко, що ні і що поміняти.
// Кожна метрика має поріг [погано, добре] для ролі. Якщо є бенчмарки OpenDota по герою —
// порівнюємо з реальними гравцями на цьому ж герої (перцентиль).
// Працює і в Node, і в браузері (веб-версія).
(function () {

const ROLES = {
  carry:       { label: 'Керрі (1)',        core: true,  lh10: [40, 60], dn10: [4, 10], lpm: [4.8, 7.2], gpm: [430, 600], xpm: [480, 660], deaths10: [3.0, 1.3], unspent: [2200, 900], firstMajor: [22, 15] },
  mid:         { label: 'Мід (2)',          core: true,  lh10: [38, 55], dn10: [5, 12], lpm: [4.2, 6.5], gpm: [430, 580], xpm: [520, 700], deaths10: [3.0, 1.5], unspent: [2000, 900], firstMajor: [19, 13] },
  offlane:     { label: 'Оффлейн (3)',      core: true,  lh10: [18, 35], dn10: [2, 6],  lpm: [3.0, 5.0], gpm: [350, 480], xpm: [430, 590], deaths10: [3.3, 1.8], unspent: [1800, 900], firstMajor: [22, 16] },
  support:     { label: 'Саппорт (4)',      core: false, gpm: [260, 360], xpm: [320, 460], deaths10: [4.0, 2.2], obs10: [1.0, 2.5], unspent: [1500, 700], firstMajor: [26, 18] },
  hardsupport: { label: 'Хард-саппорт (5)', core: false, gpm: [200, 290], xpm: [280, 400], deaths10: [4.2, 2.4], obs10: [1.8, 3.5], unspent: [1300, 600], firstMajor: [30, 21] },
};

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mmss = (s) => `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(Math.round(s)) % 60).padStart(2, '0')}`;
// погано -> 0.2, добре -> 0.8, далі лінійно (працює і для "менше = краще")
const lin = (v, [bad, good]) => clamp(0.2 + ((v - bad) / (good - bad)) * 0.6);
const rate = (s) => (s >= 0.68 ? 'good' : s >= 0.45 ? 'ok' : 'bad');

function at(timeline, t, key) {
  let best = null;
  for (const p of timeline) {
    if (p[key] == null) continue;
    if (p.t <= t + 15) best = p; else break;
  }
  return best && Math.abs(best.t - t) <= 75 ? best[key] : null;
}

function pctFromBench(arr, v) {
  if (!arr || !arr.length || v == null) return null;
  if (v <= arr[0].value) return arr[0].percentile * (v / (arr[0].value || 1));
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i - 1], b = arr[i];
    if (v <= b.value) return a.percentile + ((v - a.value) / ((b.value - a.value) || 1)) * (b.percentile - a.percentile);
  }
  return 0.99;
}

function detectRole(m) {
  if (m.role && ROLES[m.role]) return { role: m.role, auto: false };
  if (m.autoRole) return { role: m.autoRole, auto: true };
  const min = Math.max(1, m.durationSec / 60);
  const lpm = (m.final.lastHits || 0) / min;
  const obs = m.final.obsPlaced || 0;
  if (lpm < 1.6 || obs >= 4) return { role: (m.final.gpm || 0) < 300 ? 'hardsupport' : 'support', auto: true };
  if (lpm < 2.8) return { role: 'support', auto: true };
  if (lpm < 4.6) return { role: 'offlane', auto: true };
  return { role: 'carry', auto: true };
}

function analyze(m, ctx = {}) {
  const { role, auto } = ctx.role && ROLES[ctx.role] ? { role: ctx.role, auto: false } : detectRole(m);
  const R = ROLES[role];
  const F = m.final || {};
  const dur = m.durationSec || 1;
  const min = dur / 60;
  const tl = m.timeline || [];
  const heroName = ctx.heroes?.byName?.[m.hero]?.localized || prettify(m.hero);
  const itemInfo = (k) => ctx.items?.byKey?.[k];

  const metrics = [], good = [], bad = [], tips = [];
  const addTip = (prio, title, text) => tips.push({ prio, title, text });

  // перцентиль серед гравців на цьому герої (OpenDota)
  const pct = (odKey, value) => {
    if (m.odPct && m.odPct[odKey] != null) return m.odPct[odKey];
    if (ctx.bench && ctx.bench[odKey]) return pctFromBench(ctx.bench[odKey], value);
    return null;
  };

  function metric(key, label, value, display, thresholds, opts = {}) {
    if (value == null || Number.isNaN(value)) return null;
    const p = opts.pctKey ? pct(opts.pctKey, opts.pctValue ?? value) : null;
    // перцентиль 50% = «норм», 65%+ = «чотко», нижче 35% = «слабо»
    let s = p != null ? clamp(0.15 + p * 0.85) : thresholds ? lin(value, thresholds) : null;
    if (s == null) return null;
    const mt = {
      key, label, value, display, s, rating: rate(s), weight: opts.weight ?? 1,
      pct: p != null ? Math.round(p * 100) : null,
      target: thresholds ? (opts.fmtTarget ? opts.fmtTarget(thresholds[1]) : String(thresholds[1])) : null,
      hint: opts.hint || null,
    };
    metrics.push(mt);
    return mt;
  }

  // ===== ЛАЙНІНГ
  const lh10 = at(tl, 600, 'lh');
  const dn10 = at(tl, 600, 'dn');
  if (R.core && lh10 != null && dur >= 660) {
    const mt = metric('lh10', 'Ластхіти на 10 хв', lh10, String(lh10), R.lh10, { pctKey: 'lhten', weight: 1.4, hint: 'Головний показник лайнінгу' });
    if (mt.rating === 'good') good.push({ title: 'Лайн відфармлено чотко', text: `${lh10} ластхітів на 10-й хвилині — для ролі «${R.label}» це сильно (ціль ${R.lh10[1]}+).` });
    else if (mt.rating === 'bad') {
      bad.push({ title: 'Слабкий фарм на лайні', text: `Тільки ${lh10} ластхітів на 10 хв, а норм для ролі — ${R.lh10[1]}+. Це мінус ~${Math.max(0, R.lh10[1] - lh10) * 40} голди на старті.` });
      addTip(3, 'Прокачай добивання', `Перед каткою 5 хв ластхітів у демо-режимі (без предметів). Ціль — ${R.lh10[1]} на 10-й хвилині. Якщо лайн тиснуть — стій за своїми кріпами і добивай від дальнього кріпа, не розмінюй ХП.`);
    }
  }
  if (R.core && dn10 != null && dur >= 660) {
    const mt = metric('dn10', 'Денаї на 10 хв', dn10, String(dn10), R.dn10, { weight: 0.5 });
    if (mt.rating === 'good') good.push({ title: 'Денаїш як треба', text: `${dn10} денаїв за 10 хв — суперник недоотримує досвід і золото.` });
    else if (mt.rating === 'bad' && role === 'mid') addTip(1, 'Денаї на міду', 'На міду денаї — це половина війни за лайн. Добивай свого кріпа, коли в нього < 50% ХП і суперник поруч.');
  }

  // ===== ФАРМ
  if (R.core) {
    const lpm = (F.lastHits || 0) / min;
    const mt = metric('lpm', 'Ластхіти за хвилину', lpm, lpm.toFixed(1), R.lpm, { pctKey: 'last_hits_per_min', weight: 1.2, fmtTarget: (v) => v.toFixed(1) });
    if (mt.rating === 'good') good.push({ title: 'Фарм по всій катці', text: `${F.lastHits} ластхітів (${lpm.toFixed(1)}/хв) — тримав темп фарму.` });

    const lh20 = at(tl, 1200, 'lh');
    if (lh10 != null && lh20 != null && dur >= 28 * 60) {
      const mid = (lh20 - lh10) / 10;
      const late = ((F.lastHits || 0) - lh20) / ((dur - 1200) / 60);
      if (late < mid * 0.72) {
        bad.push({ title: 'Після 20-ї хвилини фарм просів', text: `10–20 хв: ${mid.toFixed(1)} крипа/хв, а після 20-ї — лише ${late.toFixed(1)}/хв. Ти більше ходив, ніж фармив.` });
        addTip(2, 'Фарм між файтами', 'Коли на карті тихо — фарми найдальшу від суперників лінію і табір лісу поруч. Схема «лінія → 2 табори → лінія». Не стій на базі і не ходи без цілі.');
      } else if (late >= mid * 1.05) {
        good.push({ title: 'Розігнався в лейті', text: `Темп фарму після 20 хв (${late.toFixed(1)}/хв) не впав, а виріс — ефективне використання карти.` });
      }
    }
  }

  metric('gpm', 'GPM (золото/хв)', F.gpm, String(F.gpm), R.gpm, { pctKey: 'gold_per_min', weight: 1.3 });
  metric('xpm', 'XPM (досвід/хв)', F.xpm, String(F.xpm), R.xpm, { pctKey: 'xp_per_min', weight: 1 });
  const gpmM = metrics.find((x) => x.key === 'gpm');
  if (gpmM?.rating === 'good') good.push({ title: 'Висока економіка', text: `${F.gpm} GPM${gpmM.pct != null ? ` — краще за ${gpmM.pct}% гравців на ${heroName}` : ''}.` });
  const xpmM = metrics.find((x) => x.key === 'xpm');
  if (xpmM?.rating === 'bad') addTip(R.core ? 1 : 2, 'Більше досвіду', R.core
    ? 'Відставання по рівню = слабші файти. Фарми там, де стоять кріпи (лінії, ліс), не простоюй мертвим і бери руни мудрості.'
    : 'Саппорту теж потрібні рівні: забирай руни мудрості, бери участь у кілах і не стій далеко від досвіду кріпів, коли нічого не робиш.');
  if (gpmM?.rating === 'bad' && R.core) addTip(2, 'Більше голди', 'Для кора GPM — це все. Стакай/забирай ліс між хвилями, не пропускай хвилі, що підходять до твоїх тавер.');

  // ===== СМЕРТІ
  const deaths = (m.deaths || []).map((d) => ({ ...d, notes: [] }));
  const d10 = (F.deaths || 0) / (min / 10);
  const dm = metric('deaths', 'Смерті на 10 хв', d10, `${F.deaths} (${d10.toFixed(1)}/10хв)`, R.deaths10, { weight: 1.4, fmtTarget: (v) => `≤${v}` });
  if (dm.rating === 'good') good.push({ title: 'Мало смертей', text: `${F.deaths} смертей за ${Math.round(min)} хв — живий герой приносить команді більше.` });
  else if (dm.rating === 'bad') {
    bad.push({ title: 'Забагато смертей', text: `${F.deaths} смертей за ${Math.round(min)} хв. Кожна смерть — це втрачене золото, час фарму і часто тавер.` });
    addTip(3, 'Менше вмирай', 'Перед тим як іти вперед — глянь на мінімапу: скільки ворогів не видно? Якщо 3+ зникли — не йди далі своїх вардів.');
  }

  const early = deaths.filter((d) => d.t < 600);
  if (early.length >= 3) {
    bad.push({ title: 'Помирав на лайні', text: `${early.length} смерті до 10-ї хвилини — лайн, скоріш за все, програно.` });
    addTip(2, 'Обережніше на лайні', 'Тримай хілку (танго/фласку) і стій ближче до своєї тавери, коли зник ворожий саппорт. Рахуй, скільки дамагу проходить по тобі за комбо суперника.');
  }

  const noTp = deaths.filter((d) => d.hadTp === false && d.t > 300);
  noTp.forEach((d) => d.notes.push('без ТП'));
  if (noTp.length >= 2) {
    bad.push({ title: 'Ходив без ТП', text: `${noTp.length} рази помер, не маючи ТП-скрола. Іноді ТП — це і є порятунок.` });
    addTip(3, 'Завжди носи ТП', 'ТП коштує 100 голди і рятує життя, тавери і файти. Купуй новий одразу, як використав.');
  }

  const rich = deaths.filter((d) => (d.unreliable || 0) >= 800);
  rich.forEach((d) => d.notes.push(`${d.unreliable} незахищеного золота`));
  if (rich.length >= 2) {
    bad.push({ title: 'Вмирав з грошима в кишені', text: `${rich.length} смертей з 800+ незахищеного золота — частина з нього згоріла.` });
    addTip(2, 'Витрачай перед ризиком', 'Йдеш у ліс суперника чи на файт з 1000+ голди — спершу купи компонент і відправ кур\'єром.');
  }

  if (R.core) {
    const lateNoBb = deaths.filter((d) => d.t >= 35 * 60 && d.buybackReady === false);
    lateNoBb.forEach((d) => d.notes.push('нема байбеку'));
    if (lateNoBb.length >= 2) {
      bad.push({ title: 'Нема золота на байбек у лейті', text: `${lateNoBb.length} пізні смерті без можливості викупитись.` });
      addTip(2, 'Тримай байбек', 'Після 35-ї хвилини завжди тримай золото на байбек, особливо перед Рошаном і хай-граундом.');
    }
  }

  // серії смертей
  for (let i = 0; i + 2 < deaths.length; i++) {
    if (deaths[i + 2].t - deaths[i].t <= 300) {
      bad.push({ title: 'Серія смертей', text: `3 смерті за 5 хвилин (${mmss(deaths[i].t)}–${mmss(deaths[i + 2].t)}). Після смерті не біжи одразу назад сам — зачекай команду або пофарми безпечно.` });
      deaths[i].notes.push('початок серії');
      break;
    }
  }

  const deadSec = deaths.reduce((s, d) => s + (d.respawn || 0), 0);
  if (deadSec > 0) {
    const share = deadSec / dur;
    metric('dead', 'Час мертвим', share * 100, `${Math.round(share * 100)}% (${mmss(deadSec)})`, [15, 5], { weight: 0.6, fmtTarget: (v) => `≤${v}%` });
  }

  // ===== KDA / УЧАСТЬ
  const kda = ((F.kills || 0) + (F.assists || 0)) / Math.max(1, F.deaths || 0);
  const km = metric('kda', 'KDA', kda, `${F.kills}/${F.deaths}/${F.assists}`, [1.5, 4.5], { weight: 0.8, fmtTarget: (v) => `${v}+` });
  if (km.rating === 'good') good.push({ title: 'Хороший KDA', text: `${F.kills}/${F.deaths}/${F.assists} — коефіцієнт ${kda.toFixed(1)}.` });

  if (F.killParticipation != null) {
    const kp = F.killParticipation * 100;
    const mt = metric('kp', 'Участь у кілах', kp, `${Math.round(kp)}%`, [40, 68], { weight: 1, fmtTarget: (v) => `${v}%+` });
    if (mt.rating === 'good') good.push({ title: 'Завжди в ділі', text: `Брав участь у ${Math.round(kp)}% кілів команди.` });
    if (mt.rating === 'bad') {
      bad.push({ title: 'Мало участі у файтах', text: `Лише ${Math.round(kp)}% кілів команди за твоєї участі.` });
      addTip(R.core ? 1 : 2, 'Будь з командою', 'Коли твоя команда збирається (смок, Рошан, пуш) — ти маєш бути там. Стеж за мінімапою кожні 3–5 секунд.');
    }
  }

  if (F.heroDamage != null) {
    const hdm = F.heroDamage / min;
    const mt = metric('hd', 'Дамаг по героях/хв', hdm, `${Math.round(hdm)}`, R.core ? [500, 900] : [250, 500], { pctKey: 'hero_damage_per_min', weight: 0.8, fmtTarget: (v) => `${v}+` });
    if (mt?.rating === 'bad' && R.core) addTip(1, 'Більше дамагу у файтах', 'Ти мало бив героїв. У файті стій так, щоб бити з першої секунди, і фокусь того, кого реально можеш вбити, а не танка.');
    if (mt?.rating === 'good') good.push({ title: 'Багато дамагу', text: `${Math.round(hdm)} дамагу по героях за хвилину${mt.pct != null ? ` — краще за ${mt.pct}% гравців на цьому герої` : ''}.` });
  }
  if (R.core && F.towerDamage != null) {
    const mt = metric('td', 'Дамаг по тавер', F.towerDamage, String(F.towerDamage), role === 'mid' ? [1000, 4000] : [1500, 6000], { pctKey: 'tower_damage', weight: 0.5, fmtTarget: (v) => `${v}+` });
    if (mt.rating === 'bad' && m.win === false) addTip(1, 'Перетворюй перевагу в тавери', 'Після виграного файту — одразу на таверу або Рошана, а не назад у ліс. Тавери дають золото всій команді і відкривають карту.');
  }

  // ===== ЗОЛОТО НА РУКАХ
  if (m.unspent && m.unspent.length >= 5) {
    const avg = m.unspent.reduce((s, x) => s + x.gold, 0) / m.unspent.length;
    const mt = metric('unspent', 'Середнє золото на руках', avg, `${Math.round(avg)}`, R.unspent, { weight: 0.7, fmtTarget: (v) => `≤${v}` });
    if (mt.rating === 'bad') {
      bad.push({ title: 'Сидиш на грошах', text: `Після 10 хв у тебе в середньому ${Math.round(avg)} невитраченого золота. Гроші в кишені не б'ють.` });
      addTip(2, 'Витрачай золото', 'Плануй білд заздалегідь, щоб купувати одразу. Кур\'єр — твій друг: купуй компоненти, як тільки вистачає.');
    } else if (mt.rating === 'good') good.push({ title: 'Гроші в ділі', text: 'Золото не залежувалось — швидко перетворював його в предмети.' });
  }

  // ===== ПРЕДМЕТИ
  const isMajor = (k) => { const it = itemInfo(k); return it && it.cost >= 1800 && it.components && !k.startsWith('recipe'); };
  const majors = (m.itemTimings || []).filter((x) => isMajor(x.item));
  const firstMajor = majors[0];
  if (firstMajor && R.firstMajor) {
    const mins = firstMajor.t / 60;
    const name = itemInfo(firstMajor.item)?.name || prettify(firstMajor.item);
    const mt = metric('firstItem', 'Перший великий предмет', mins, `${name} — ${mmss(firstMajor.t)}`, R.firstMajor, { weight: 0.9, fmtTarget: (v) => `до ${v}:00` });
    if (mt.rating === 'good') good.push({ title: 'Швидкий перший предмет', text: `${name} на ${mmss(firstMajor.t)} — хороший таймінг.` });
    else if (mt.rating === 'bad') {
      bad.push({ title: 'Повільний таймінг предмета', text: `${name} тільки на ${mmss(firstMajor.t)}. Для ролі «${R.label}» хочеться до ${R.firstMajor[1]}:00.` });
      if (R.core) addTip(1, 'Таймінги', 'Не збирай багато дрібних предметів до першого кор-айтема. Обери 1 ключовий предмет і йди в нього напряму.');
    }
  }
  const hasBkb = (m.itemTimings || []).some((x) => x.item === 'black_king_bar') || (m.finalItems || []).includes('black_king_bar');
  if (R.core && !hasBkb && dur > 32 * 60 && deaths.filter((d) => d.t > 25 * 60).length >= 3) {
    addTip(1, 'Подумай про BKB', 'Ти часто вмирав у файтах пізньої гри і не мав BKB. Якщо в суперників багато контролю — BKB часто найкращий предмет.');
  }

  // ===== ВАРДИ
  if (!R.core && F.obsPlaced != null) {
    const o10 = F.obsPlaced / (min / 10);
    const mt = metric('wards', 'Обс-варди на 10 хв', o10, `${F.obsPlaced}${m.source === 'gsi' ? ' (~)' : ''}`, R.obs10, { weight: 1.2, fmtTarget: (v) => `${v}+/10хв` });
    if (mt.rating === 'good') good.push({ title: 'Чотко варднув карту', text: `${F.obsPlaced} обсерверів — команда бачила, що відбувається.` });
    else if (mt.rating === 'bad') {
      bad.push({ title: 'Мало вардів', text: `Лише ${F.obsPlaced} обсерверів за ${Math.round(min)} хв.` });
      addTip(3, 'Варди', 'Тримай обсервери завжди в інвентарі і став їх, щойно відкат на складі. Ставь не тільки «вдома», а й на шляхах до своїх корів.');
    }
  }
  if (!R.core && F.campsStacked != null && F.campsStacked >= 3) good.push({ title: 'Стаки', text: `${F.campsStacked} застаканих таборів — подарунок для керрі.` });
  if (F.stuns != null && F.stuns > 0) metric('stuns', 'Секунд контролю', F.stuns, `${Math.round(F.stuns)} с`, null, { pctKey: 'stuns_per_min', pctValue: F.stuns / min, weight: 0.4 });

  // ===== ОЦІНКА
  let wsum = 0, ssum = 0;
  for (const mt of metrics) { wsum += mt.weight; ssum += mt.weight * mt.s; }
  let score = wsum ? (ssum / wsum) * 100 : 50;
  if (m.win === true) score += 4;
  score = Math.round(clamp(score, 0, 100));
  const grade = score >= 85 ? 'S' : score >= 72 ? 'A' : score >= 58 ? 'B' : score >= 45 ? 'C' : 'D';

  tips.sort((a, b) => b.prio - a.prio);
  if (!tips.length) tips.push({ prio: 0, title: 'Тримай планку', text: 'Явних проблем не видно. Наступний крок — грати на вищому темпі: швидше переходити від фарму до цілей (тавери, Рошан).' });

  const verdict = buildVerdict(grade, m.win, good, bad);

  // ===== ФАЗИ ГРИ
  const phases = [];
  const ranges = [['Лайнінг', 0, 600], ['Мідгейм', 600, 1500], ['Лейт', 1500, Infinity]];
  for (const [name, a, b0] of ranges) {
    const b = Math.min(b0, dur);
    if (b <= a + 60) continue;
    const lhA = a === 0 ? 0 : at(tl, a, 'lh'), lhB = b >= dur ? F.lastHits : at(tl, b, 'lh');
    const d = deaths.filter((x) => x.t >= a && x.t < b).length;
    phases.push({ name, from: a, to: b, lpm: lhA != null && lhB != null ? (lhB - lhA) / ((b - a) / 60) : null, deaths: d });
  }

  // ===== ГРАФІКИ
  const charts = { lh: tl.filter((p) => p.lh != null).map((p) => ({ t: p.t, v: p.lh })) };
  if (R.core) {
    const g10 = R.lh10[1], gl = R.lpm[1];
    charts.lhTarget = [{ t: 0, v: 0 }, { t: 600, v: g10 }, { t: Math.max(dur, 601), v: g10 + ((Math.max(dur, 601) - 600) / 60) * gl }];
  }
  const hasNw = tl.some((p) => p.nw != null);
  charts.gold = tl.filter((p) => (hasNw ? p.nw : p.gold) != null).map((p) => ({ t: p.t, v: hasNw ? p.nw : p.gold }));
  charts.goldLabel = hasNw ? (m.source === 'gsi' ? 'Нетворс' : 'Зароблене золото') : 'Золото на руках';

  return {
    role, roleAuto: auto, roleLabel: R.label, roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])),
    heroName, score, grade, verdict, metrics, good, bad, tips, deaths, phases, charts,
    items: (m.itemTimings || []).filter((x) => !x.item.startsWith('recipe')).map((x) => {
      const it = itemInfo(x.item);
      return { t: x.t, item: x.item, name: it?.name || prettify(x.item), cost: it?.cost ?? null, major: !!isMajor(x.item) };
    }),
    finalItems: (m.finalItems || []).map((k) => ({ item: k, name: itemInfo(k)?.name || prettify(k) })),
    durationSec: dur,
    focus: tips.slice(0, 3).map((t) => t.title),
    goldSources: F.goldFromCreepKills != null ? {
      'Кріпи': F.goldFromCreepKills, 'Герої': F.goldFromHeroKills, 'Пасивне': F.goldFromIncome, 'Спільне': F.goldFromShared,
    } : null,
    apm: F.apm ?? (F.commands ? Math.round(F.commands / min) : null),
    benchSource: m.odPct && Object.keys(m.odPct).length ? 'opendota-match' : ctx.bench ? 'opendota-hero' : 'role-table',
  };
}

function buildVerdict(grade, win, good, bad) {
  const res = win === true ? 'Перемога' : win === false ? 'Поразка' : 'Катка';
  const g = good[0]?.title.toLowerCase();
  const b = bad[0]?.title.toLowerCase();
  const lead = { S: 'Розірвав', A: 'Сильна гра', B: 'Норм катка', C: 'Є над чим працювати', D: 'Важка катка' }[grade];
  if (g && b) return `${lead}. ${res}: плюс — ${g}, мінус — ${b}.`;
  if (g) return `${lead}. ${res}: ${g} — так і продовжуй.`;
  if (b) return `${lead}. ${res}: головне, що треба виправити — ${b}.`;
  return `${lead}. ${res}.`;
}

function prettify(s) {
  return (s || '').replace(/^item_/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const api = { analyze, ROLES, mmss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.Coach = api;
})();

// Симуляція катки — шле в коуча фейкові дані, ніби ти граєш.
// Корисно, щоб подивитись інтерфейс без гри:  node simulate.js
const http = require('http');
const TOKEN = 'dotacoach_local_9f3k';
const PORT = Number(process.env.PORT) || 3000;
const SPEED = Number(process.argv[2]) || 40; // ігрових секунд за 0.1с реального

const post = (data) => new Promise((res) => {
  const body = JSON.stringify(data);
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/gsi', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => { r.resume(); r.on('end', res); });
  req.on('error', () => { console.error('Сервер не запущено. Спершу: node server.js'); process.exit(1); });
  req.end(body);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const END = 41 * 60 + 17;
const deathsAt = [190, 420, 515, 1340, 1390, 1500, 2300, 2390];
const noTpWindow = (t) => (t > 1200 && t < 1550);
const buys = [[-80, 'item_tango'], [-80, 'item_quelling_blade'], [-80, 'item_branches'], [-70, 'item_slippers'],
  [300, 'item_wraith_band'], [520, 'item_phase_boots'], [960, 'item_mithril_hammer'], [1260, 'item_maelstrom'],
  [1700, 'item_yasha'], [1980, 'item_manta'], [2350, 'item_black_king_bar'], [2600, 'item_butterfly']];

(async () => {
  const matchId = String(7_900_000_000 + Math.floor(Math.random() * 99_999_999));
  let lh = 0, dn = 0, gold = 600, k = 0, d = 0, a = 0, dead = 0, gpmGold = 0;
  console.log(`Симулюю катку ${matchId} (Juggernaut)…`);
  for (let t = -90; t <= END; t += 5) {
    // фарм: на лайні слабенько, потім розганяється
    const rate = t < 0 ? 0 : t < 600 ? 4.1 : t < 1500 ? 6.4 : 5.2;
    if (dead <= 0) { if (Math.random() < rate * 5 / 60) { lh++; gold += 42; gpmGold += 42; } if (t < 600 && Math.random() < 0.06) dn++; }
    gold += 1.6 * 5 / 3; gpmGold += 1.6 * 5 / 3;
    if (Math.random() < 0.012) { k++; gold += 220; gpmGold += 220; }
    if (Math.random() < 0.02) a++;
    if (dead > 0) dead = Math.max(0, dead - 5);
    const died = deathsAt.some((x) => x <= t && x > t - 5);
    if (died) { d++; gold = Math.max(0, gold - Math.round(gold * 0.3)); dead = 10 + Math.floor(t / 60) * 1.5; }

    const items = {};
    const owned = buys.filter(([bt]) => bt <= t).map(([, n]) => n);
    // імітуємо збирання: компоненти зникають
    const final = owned.filter((n) => !(n === 'item_mithril_hammer' && owned.includes('item_maelstrom')) && !(n === 'item_yasha' && owned.includes('item_manta')) && !(n === 'item_tango' && t > 400) && !(n === 'item_branches' && t > 800) && !(n === 'item_slippers' && t > 300)).slice(-6);
    final.forEach((n, i) => (items['slot' + i] = { name: n }));
    for (let i = final.length; i < 9; i++) items['slot' + i] = { name: 'empty' };
    items.teleport0 = { name: noTpWindow(t) || t < 60 ? 'empty' : 'item_tpscroll' };
    // золото, витрачене на покупки
    for (const [bt, n] of buys) if (bt > t - 5 && bt <= t && t > 0) gold = Math.max(0, gold - (n.includes('manta') || n.includes('black_king') ? 2400 : n.includes('butterfly') ? 3000 : 900));

    const min = Math.max(1, t / 60);
    await post({
      auth: { token: TOKEN },
      provider: { name: 'Dota 2', appid: 570 },
      map: { matchid: matchId, game_time: t + 90, clock_time: t, game_state: t < 0 ? 'DOTA_GAMERULES_STATE_PRE_GAME' : 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', win_team: 'none' },
      player: { name: 'You', team_name: 'radiant', kills: k, deaths: d, assists: a, last_hits: lh, denies: dn,
        gold: Math.round(gold), gold_reliable: Math.round(gold * 0.3), gold_unreliable: Math.round(gold * 0.7), gpm: Math.round((gpmGold + 600) / min), xpm: Math.round(t < 600 ? 430 : 560),
        gold_from_hero_kills: k * 220, gold_from_creep_kills: lh * 42, gold_from_income: Math.max(0, Math.round(t * 1.6)), gold_from_shared: a * 90, commands_issued: Math.round(t * 2.6) },
      hero: { name: 'npc_dota_hero_juggernaut', level: Math.min(30, 1 + Math.floor(t / 85)), alive: dead <= 0, respawn_seconds: Math.max(0, Math.round(dead)), buyback_cost: 200 + Math.floor(t / 60) * 30, buyback_cooldown: 0 },
      items,
    });
    if (t % 300 === 0) console.log(`  ${Math.floor(t / 60)}:00  ${k}/${d}/${a}  LH ${lh}`);
    await sleep(100 * 5 / SPEED);
  }
  await post({ auth: { token: TOKEN }, map: { matchid: matchId, clock_time: END, game_state: 'DOTA_GAMERULES_STATE_POST_GAME', win_team: 'radiant' },
    player: { team_name: 'radiant', kills: k, deaths: d, assists: a, last_hits: lh, denies: dn, gold: 500, gpm: 610, xpm: 640 }, hero: { name: 'npc_dota_hero_juggernaut', level: 25, alive: true }, items: {} });
  console.log('Готово! Відкрий http://localhost:' + PORT);
})();

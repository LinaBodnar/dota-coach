// Приймає дані Game State Integration від клієнта Dota 2 і збирає з них "запис катки".
// Dota шле POST з JSON кожні ~0.5с, поки ти в грі.

const SAMPLE_EVERY = 10; // секунд ігрового часу між точками таймлайну
const CONSUMABLES = new Set([
  'tango', 'tango_single', 'flask', 'clarity', 'enchanted_mango', 'faerie_fire', 'tpscroll',
  'ward_observer', 'ward_sentry', 'ward_dispenser', 'dust', 'smoke_of_deceit', 'bottle',
  'blood_grenade', 'famango', 'great_famango', 'greater_famango', 'cheese', 'aegis',
  'refresher_shard', 'royal_jelly', 'tome_of_knowledge', 'river_painter', 'river_painter2',
]);

const strip = (n) => (n || '').replace(/^item_/, '');

function collectItems(items) {
  const inv = [], backpack = [], stash = [], all = [];
  let tp = false, neutral = null, obsCharges = 0, senCharges = 0;
  if (!items) return { inv, backpack, stash, all, tp, neutral, obsCharges, senCharges };
  for (const [slot, it] of Object.entries(items)) {
    if (!it || !it.name || it.name === 'empty') continue;
    const name = strip(it.name);
    if (slot.startsWith('teleport')) { tp = true; continue; }
    if (slot.startsWith('neutral')) { neutral = name; continue; }
    if (name === 'tpscroll' || name === 'travel_boots' || name === 'travel_boots_2') tp = true;
    if (name === 'ward_observer') obsCharges += it.charges || 0;
    if (name === 'ward_sentry') senCharges += it.charges || 0;
    if (name === 'ward_dispenser') { obsCharges += it.charges || 0; senCharges += it.secondary_charges || 0; }
    const n = parseInt(slot.replace(/\D/g, ''), 10);
    if (slot.startsWith('slot')) (n <= 5 ? inv : backpack).push(name);
    else if (slot.startsWith('stash')) stash.push(name);
    all.push(name);
  }
  return { inv, backpack, stash, all, tp, neutral, obsCharges, senCharges };
}

class GsiSession {
  constructor({ onFinish, onAccount }) {
    this.onFinish = onFinish;
    this.onAccount = onAccount;
    this.match = null;
    this.lastPacketAt = 0;
    this.lastRaw = null;
  }

  ingest(p) {
    this.lastPacketAt = Date.now();
    this.lastRaw = p;
    const map = p.map, pl = p.player, hero = p.hero;

    if (pl && pl.accountid && this.onAccount) this.onAccount(String(pl.accountid));

    // У меню / спектейт / немає наших даних — якщо була катка, закриваємо її
    if (!map || !pl || pl.kills === undefined || !hero || !hero.name) {
      if (this.match && this.match.started) this.finish('left');
      return;
    }

    const matchId = String(map.matchid || 'local');
    if (this.match && this.match.id !== matchId) this.finish('new-match');

    if (!this.match) {
      this.match = {
        id: matchId,
        source: 'gsi',
        createdAt: new Date().toISOString(),
        hero: hero.name.replace('npc_dota_hero_', ''),
        team: pl.team_name,
        accountId: pl.accountid ? String(pl.accountid) : null,
        playerName: pl.name || null,
        started: false,
        win: null,
        durationSec: 0,
        timeline: [],
        deaths: [],
        itemTimings: [],
        startItems: [],
        seenItems: [],
        finalItems: [],
        unspent: [],
        wards: { obsPlaced: 0, senPlaced: 0 },
        final: {},
        _last: null,
      };
    }

    const m = this.match;
    const t = Math.round(map.clock_time ?? 0);
    const state = map.game_state || '';
    if (state.includes('PRE_GAME') || state.includes('GAME_IN_PROGRESS')) m.started = true;
    if (!m.started) return;

    const inv = collectItems(p.items);
    const last = m._last;

    // ---- предмети: фіксуємо час, коли предмет з'явився вперше
    for (const name of inv.all) {
      if (CONSUMABLES.has(name) || m.seenItems.includes(name)) continue;
      m.seenItems.push(name);
      if (t <= 0) m.startItems.push(name);
      else m.itemTimings.push({ t, item: name });
    }
    if (inv.all.length) {
      m.finalItems = inv.inv;
      m.finalBackpack = inv.backpack;
      m.neutral = inv.neutral;
    }

    // ---- варди: якщо заряди впали, поки ти живий — скоріш за все поставив
    if (last && hero.alive) {
      if (inv.obsCharges < last.obs) m.wards.obsPlaced += last.obs - inv.obsCharges;
      if (inv.senCharges < last.sen) m.wards.senPlaced += last.sen - inv.senCharges;
    }

    // ---- смерті
    if (last && pl.deaths > last.deaths) {
      m.deaths.push({
        t,
        unreliable: last.gu,
        gold: last.gold,
        hadTp: last.tp,
        buybackReady: last.bbReady,
        respawn: hero.respawn_seconds || 0,
        level: hero.level,
      });
    }
    // час респавну іноді приходить наступним пакетом — оновлюємо
    if (m.deaths.length && !hero.alive) {
      const d = m.deaths[m.deaths.length - 1];
      if (t - d.t < 5) d.respawn = Math.max(d.respawn, hero.respawn_seconds || 0);
    }

    // ---- таймлайн
    const lastSample = m.timeline[m.timeline.length - 1];
    if (t >= 0 && (!lastSample || t - lastSample.t >= SAMPLE_EVERY)) {
      m.timeline.push({
        t, lh: pl.last_hits, dn: pl.denies, gold: pl.gold, nw: pl.net_worth ?? null,
        lvl: hero.level, k: pl.kills, d: pl.deaths, a: pl.assists, gpm: pl.gpm, xpm: pl.xpm,
      });
      if (t >= 600 && hero.alive) m.unspent.push({ t, gold: pl.gold });
    }

    m.durationSec = Math.max(m.durationSec, t);
    m.final = {
      kills: pl.kills, deaths: pl.deaths, assists: pl.assists,
      lastHits: pl.last_hits, denies: pl.denies, gpm: pl.gpm, xpm: pl.xpm,
      level: hero.level, netWorth: pl.net_worth ?? null,
      goldFromHeroKills: pl.gold_from_hero_kills, goldFromCreepKills: pl.gold_from_creep_kills,
      goldFromIncome: pl.gold_from_income, goldFromShared: pl.gold_from_shared,
      commands: pl.commands_issued,
      obsPlaced: m.wards.obsPlaced, senPlaced: m.wards.senPlaced,
    };

    m._last = {
      deaths: pl.deaths, gold: pl.gold, gu: pl.gold_unreliable, tp: inv.tp,
      bbReady: (hero.buyback_cooldown || 0) === 0 && pl.gold >= (hero.buyback_cost || 1e9),
      obs: inv.obsCharges, sen: inv.senCharges,
    };

    // ---- кінець катки
    const ended = state.includes('POST_GAME') || (map.win_team && map.win_team !== 'none');
    if (ended) {
      m.win = map.win_team ? map.win_team === pl.team_name : null;
      this.finish('end');
    }
  }

  finish(reason) {
    const m = this.match;
    this.match = null;
    if (!m || !m.started) return;
    delete m._last;
    delete m.seenItems;
    m.endReason = reason;
    if (m.durationSec < 120) return; // занадто коротко — нічого аналізувати
    this.onFinish(m);
  }

  live() {
    const m = this.match;
    const connected = Date.now() - this.lastPacketAt < 15000;
    if (!m || !m.started) return { connected, inGame: false };
    const p = this.lastRaw || {};
    return {
      connected, inGame: true, id: m.id, hero: m.hero, t: m.durationSec,
      final: m.final, gold: p.player?.gold ?? 0, alive: p.hero?.alive,
      hasTp: collectItems(p.items).tp, deaths: m.deaths.length, timeline: m.timeline,
      items: m.finalItems,
    };
  }
}

module.exports = { GsiSession, collectItems };

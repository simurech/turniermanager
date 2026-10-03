// Reine Turnierlogik ohne UI: Spielplan, Tabelle, K.O.-Runde, Endrangliste, Änderungen (Ops).
// Spieler werden überall über ihren Index in `doc.players` angesprochen.

export const DEFAULT_CONFIG = {
  numPlayers: 7,
  numTVs: 1,
  doubleRoundRobin: false,
  tiebreaker: 'goalDiff', // 'goalDiff' | 'head2head'
  thirdPlacePlayoff: true,
};

export const isPlayed = (m) => m && m.homeGoals != null && m.awayGoals != null;

// ------------------------------------------------------------------ Spielplan

/** Alle Paarungen einer Hin-/Rückrunde nach der Kreismethode, mit ausgeglichenem Heimrecht. */
function legPairings(n, shift = 0) {
  const ids = Array.from({ length: n }, (_, i) => (i + shift) % n);
  if (n % 2 === 1) ids.push(null);
  const size = ids.length;
  const pairs = [];
  for (let r = 0; r < size - 1; r++) {
    for (let i = 0; i < size / 2; i++) {
      const a = ids[i];
      const b = ids[size - 1 - i];
      if (a === null || b === null) continue;
      pairs.push([a, b]);
    }
    ids.splice(1, 0, ids.pop());
  }
  return balanceHomeAway(pairs, n);
}

/** Summe der Quadrate der Abweichungen: je kleiner, desto gleichmässiger. */
const imbalance = (balance) => balance.reduce((sum, b) => sum + b * b, 0);

/**
 * Verteilt Heim- und Auswärtsrecht so, dass jeder Spieler möglichst gleich oft zuhause und auswärts spielt.
 * Erst eine einfache Verteilung, dann werden einzelne Spiele gedreht, solange es die Verteilung verbessert.
 */
function balanceHomeAway(pairs, n) {
  const balance = new Array(n).fill(0); // Heimspiele minus Auswärtsspiele
  const result = pairs.map(([a, b]) => {
    const [home, away] = balance[a] <= balance[b] ? [a, b] : [b, a];
    balance[home]++;
    balance[away]--;
    return [home, away];
  });
  for (let pass = 0; pass < 30; pass++) {
    let improved = false;
    result.forEach((pair, i) => {
      const [home, away] = pair;
      const before = imbalance(balance);
      balance[home] -= 2;
      balance[away] += 2;
      if (imbalance(balance) < before) {
        result[i] = [away, home];
        improved = true;
      } else {
        balance[home] += 2;
        balance[away] -= 2;
      }
    });
    if (!improved) break;
  }
  return result;
}

/**
 * Verteilt die Spiele bei 2 Fernsehern so auf TV 1 und TV 2, dass jeder Spieler möglichst gleich oft
 * auf beiden spielt. Pro Runde gibt es nur zwei Möglichkeiten (Fernseher tauschen oder nicht), die Paarungen
 * bleiben. Bei bis zu 16 Runden wird alles durchprobiert, sonst gibt es viele Suchläufe mit festem Startwert.
 */
function balanceTvs(matches, n) {
  const rounds = [...Map.groupBy(matches, (m) => m.round).values()];
  const base = new Map(matches.map((m) => [m, m.tv]));
  const costOf = (flips) => {
    const balance = new Array(n).fill(0); // Spiele auf TV 1 minus Spiele auf TV 2
    rounds.forEach((list, r) => {
      for (const m of list) {
        const tv = flips[r] ? (base.get(m) === 1 ? 2 : 1) : base.get(m);
        const d = tv === 1 ? 1 : -1;
        balance[m.homePlayer] += d;
        balance[m.awayPlayer] += d;
      }
    });
    return imbalance(balance);
  };

  let best = new Array(rounds.length).fill(false);
  let bestCost = costOf(best);
  if (rounds.length <= 16) {
    for (let mask = 1; mask < 1 << rounds.length; mask++) {
      const flips = rounds.map((_, r) => Boolean((mask >> r) & 1));
      const cost = costOf(flips);
      if (cost < bestCost) {
        best = flips;
        bestCost = cost;
      }
    }
  } else {
    let seed = 12345;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let start = 0; start < 300 && bestCost > 0; start++) {
      const flips = rounds.map(() => random() < 0.5);
      let cost = costOf(flips);
      for (let improved = true; improved; ) {
        improved = false;
        for (let r = 0; r < flips.length; r++) {
          flips[r] = !flips[r];
          const next = costOf(flips);
          if (next < cost) {
            cost = next;
            improved = true;
          } else {
            flips[r] = !flips[r];
          }
        }
      }
      if (cost < bestCost) {
        best = [...flips];
        bestCost = cost;
      }
    }
  }
  rounds.forEach((list, r) => {
    if (best[r]) for (const m of list) m.tv = base.get(m) === 1 ? 2 : 1;
  });
}

/**
 * Verteilt die Paarungen auf Runden (Zeitfenster). Pro Runde spielen höchstens `numTVs`
 * Spiele gleichzeitig, kein Spieler doppelt. Es werden die Spieler bevorzugt, die am längsten pausiert haben.
 */
function buildSchedule(numPlayers, numTVs, doubleRoundRobin, shift) {
  const legs = [legPairings(numPlayers, shift)];
  if (doubleRoundRobin) legs.push(legPairings(numPlayers, shift).map(([h, a]) => [a, h]));

  const lastRound = new Array(numPlayers).fill(-3);
  const matches = [];
  let round = 0;
  for (const pairs of legs) {
    const remaining = [...pairs];
    while (remaining.length) {
      round++;
      const chosen = [];
      const busy = new Set();
      while (chosen.length < numTVs) {
        let best = -1;
        let bestScore = -Infinity;
        remaining.forEach(([h, a], idx) => {
          if (busy.has(h) || busy.has(a)) return;
          const score = Math.min(round - lastRound[h], round - lastRound[a]) * 10 + (round - lastRound[h]) + (round - lastRound[a]);
          if (score > bestScore) {
            bestScore = score;
            best = idx;
          }
        });
        if (best < 0) break;
        const [h, a] = remaining.splice(best, 1)[0];
        chosen.push([h, a]);
        busy.add(h);
        busy.add(a);
      }
      chosen.forEach(([h, a], tvIdx) => {
        lastRound[h] = round;
        lastRound[a] = round;
        matches.push({ id: matches.length, homePlayer: h, awayPlayer: a, homeGoals: null, awayGoals: null, tv: tvIdx + 1, round });
      });
    }
  }
  if (numTVs === 2) balanceTvs(matches, numPlayers);
  return matches;
}

/** Abweichung der Fernseher-Verteilung: Summe der Quadrate von (Spiele auf TV 1 minus Spiele auf TV 2) je Spieler. */
function tvImbalance(matches, n) {
  const balance = new Array(n).fill(0);
  for (const m of matches) {
    const d = m.tv === 1 ? 1 : -1;
    balance[m.homePlayer] += d;
    balance[m.awayPlayer] += d;
  }
  return imbalance(balance);
}

/**
 * Erstellt den Spielplan. Bei 2 Fernsehern werden verschiedene Startreihenfolgen der Spieler probiert
 * und die gewählt, bei der jeder Spieler am gleichmässigsten auf TV 1 und TV 2 spielt.
 */
export function scheduleMatches(numPlayers, numTVs = 1, doubleRoundRobin = false) {
  if (numTVs !== 2) return buildSchedule(numPlayers, numTVs, doubleRoundRobin, 0);
  let best = null;
  let bestCost = Infinity;
  for (let shift = 0; shift < numPlayers; shift++) {
    const candidate = buildSchedule(numPlayers, numTVs, doubleRoundRobin, shift);
    const cost = tvImbalance(candidate, numPlayers);
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}

// ------------------------------------------------------------------ Tabelle

function blankRow(playerId) {
  return { playerId, played: 0, won: 0, draw: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 };
}

function tally(playerIds, matches) {
  const rows = new Map(playerIds.map((id) => [id, blankRow(id)]));
  for (const m of matches) {
    if (!isPlayed(m)) continue;
    const h = rows.get(m.homePlayer);
    const a = rows.get(m.awayPlayer);
    if (!h || !a) continue;
    h.played++;
    a.played++;
    h.goalsFor += m.homeGoals;
    h.goalsAgainst += m.awayGoals;
    a.goalsFor += m.awayGoals;
    a.goalsAgainst += m.homeGoals;
    if (m.homeGoals > m.awayGoals) {
      h.won++;
      h.points += 3;
      a.lost++;
    } else if (m.homeGoals < m.awayGoals) {
      a.won++;
      a.points += 3;
      h.lost++;
    } else {
      h.draw++;
      a.draw++;
      h.points++;
      a.points++;
    }
  }
  for (const r of rows.values()) r.goalDiff = r.goalsFor - r.goalsAgainst;
  return [...rows.values()];
}

// Letztes Kriterium ist die Reihenfolge der Eingabe, damit die Tabelle vor dem ersten Spiel
// in der gewohnten Spielerreihenfolge steht.
const byOverall = () => (a, b) =>
  b.goalDiff - a.goalDiff ||
  b.goalsFor - a.goalsFor ||
  a.goalsAgainst - b.goalsAgainst ||
  b.won - a.won ||
  a.lost - b.lost ||
  a.playerId - b.playerId;

/**
 * Tabelle nach Punkten. Bei Punktgleichheit entweder direkter Vergleich als Mini-Tabelle
 * (tiebreaker 'head2head') und danach Tordifferenz, Tore, Gegentore, Siege, Niederlagen, Name.
 */
export function computeStandings(players, matches, tiebreaker = 'goalDiff') {
  const rows = tally(players.map((_, i) => i), matches);
  const overall = byOverall();

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.points)) groups.set(r.points, []);
    groups.get(r.points).push(r);
  }
  const sorted = [];
  for (const points of [...groups.keys()].sort((a, b) => b - a)) {
    let group = groups.get(points);
    if (group.length > 1 && tiebreaker === 'head2head') {
      const ids = new Set(group.map((r) => r.playerId));
      const mini = new Map(
        tally([...ids], matches.filter((m) => ids.has(m.homePlayer) && ids.has(m.awayPlayer))).map((r) => [r.playerId, r]),
      );
      group = group.sort((a, b) => {
        const x = mini.get(a.playerId);
        const y = mini.get(b.playerId);
        return y.points - x.points || y.goalDiff - x.goalDiff || y.goalsFor - x.goalsFor || overall(a, b);
      });
    } else {
      group = group.sort(overall);
    }
    sorted.push(...group);
  }
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ------------------------------------------------------------------ K.O.-Runde

/**
 * Format: Halbfinale (1-4, 2-3), Finale, optional Spiel um Platz 3.
 * Verlierer-Runde für die Plätze 5 bis n der Gruppentabelle:
 *   5 Spieler: keine, Platz 5 ist Letzter.
 *   6 Spieler: Verlierer-Final 5 gegen 6.
 *   7 Spieler: Verlierer-Halbfinale 5 gegen 6. Der Verlierer muss im Verlierer-Final gegen Platz 7 antreten.
 *   8 Spieler: Verlierer-Halbfinale 5 gegen 8 und 6 gegen 7. Die beiden Verlierer spielen das Verlierer-Final.
 * Wer das Verlierer-Final verliert, ist der Turnier-Verlierer.
 */
export function knockoutSlots(numPlayers, config = DEFAULT_CONFIG) {
  const slots = [
    { id: 'sf1', type: 'semi', label: 'Halbfinale 1' },
    { id: 'sf2', type: 'semi', label: 'Halbfinale 2' },
    { id: 'final', type: 'final', label: 'Finale', placeholders: { home: 'Sieger Halbfinale 1', away: 'Sieger Halbfinale 2' } },
  ];
  if (config.thirdPlacePlayoff) {
    slots.push({ id: 'third', type: 'third', label: 'Spiel um Platz 3', placeholders: { home: 'Verlierer Halbfinale 1', away: 'Verlierer Halbfinale 2' } });
  }
  if (numPlayers === 6) {
    slots.push({ id: 'lf', type: 'loserFinal', label: 'Verlierer-Final' });
  } else if (numPlayers === 7) {
    slots.push({ id: 'ls1', type: 'loserSemi', label: 'Verlierer-Halbfinale' });
    slots.push({ id: 'lf', type: 'loserFinal', label: 'Verlierer-Final', placeholders: { home: 'Verlierer Verlierer-Halbfinale' } });
  } else if (numPlayers >= 8) {
    slots.push({ id: 'ls1', type: 'loserSemi', label: 'Verlierer-Halbfinale 1' });
    slots.push({ id: 'ls2', type: 'loserSemi', label: 'Verlierer-Halbfinale 2' });
    slots.push({ id: 'lf', type: 'loserFinal', label: 'Verlierer-Final', placeholders: { home: 'Verlierer Verl.-Halbfinale 1', away: 'Verlierer Verl.-Halbfinale 2' } });
  }
  return slots;
}

const winnerOf = (m) => (m.homeGoals > m.awayGoals ? m.homePlayer : m.awayPlayer);
const loserOf = (m) => (m.homeGoals > m.awayGoals ? m.awayPlayer : m.homePlayer);

/**
 * Berechnet alle K.O.-Spiele aus der Gruppentabelle und den gespeicherten Ergebnissen.
 * Ein gespeichertes Ergebnis gilt nur, wenn dieselben zwei Spieler antreten wie bei der Eingabe.
 * Sonst ist es `stale` (veraltet) und zählt nicht.
 */
export function resolveKnockout(standings, config, stored = []) {
  const n = standings.length;
  const seed = (i) => standings[i]?.playerId ?? null;
  const results = new Map(stored.map((s) => [s.id, s]));
  const out = new Map();

  const make = (slot, home, away) => {
    const s = results.get(slot.id);
    const ready = home != null && away != null;
    const same = s && s.home === home && s.away === away;
    const valid = ready && same && s.homeGoals != null && s.awayGoals != null && s.homeGoals !== s.awayGoals;
    const m = {
      ...slot,
      homePlayer: home,
      awayPlayer: away,
      homeGoals: valid ? s.homeGoals : null,
      awayGoals: valid ? s.awayGoals : null,
      ready,
      stale: Boolean(s && s.homeGoals != null && ready && !valid),
    };
    m.done = valid;
    m.winner = valid ? winnerOf(m) : null;
    m.loser = valid ? loserOf(m) : null;
    out.set(slot.id, m);
    return m;
  };

  if (n < 4) return [];
  const slots = knockoutSlots(n, config);
  const slot = (id) => slots.find((s) => s.id === id);

  const sf1 = make(slot('sf1'), seed(0), seed(3));
  const sf2 = make(slot('sf2'), seed(1), seed(2));
  make(slot('final'), sf1.winner, sf2.winner);
  if (config.thirdPlacePlayoff) make(slot('third'), sf1.loser, sf2.loser);

  if (n === 6) {
    make(slot('lf'), seed(4), seed(5));
  } else if (n === 7) {
    const ls1 = make(slot('ls1'), seed(4), seed(5));
    make(slot('lf'), ls1.loser, seed(6));
  } else if (n >= 8) {
    const ls1 = make(slot('ls1'), seed(4), seed(7));
    const ls2 = make(slot('ls2'), seed(5), seed(6));
    make(slot('lf'), ls1.loser, ls2.loser);
  }
  return slots.map((s) => out.get(s.id));
}

/** Endrangliste (Spielerindizes von Platz 1 bis n) oder null, solange noch Spiele offen sind. */
export function computeRanking(standings, knockout, config) {
  const n = standings.length;
  if (n < 4 || knockout.some((m) => !m.done)) return null;
  const k = Object.fromEntries(knockout.map((m) => [m.id, m]));
  const rankOf = (id) => standings.findIndex((r) => r.playerId === id);
  const byGroupRank = (a, b) => rankOf(a) - rankOf(b);
  const ranking = [k.final.winner, k.final.loser];
  if (config.thirdPlacePlayoff) {
    ranking.push(k.third.winner, k.third.loser);
  } else {
    ranking.push(...[k.sf1.loser, k.sf2.loser].sort(byGroupRank));
  }
  // Wer die Verlierer-Runde nicht verloren hat, ist sicher und steht vor den Spielern des Verlierer-Finals.
  if (n === 5) ranking.push(standings[4].playerId);
  if (n === 6) ranking.push(k.lf.winner, k.lf.loser);
  if (n === 7) ranking.push(k.ls1.winner, k.lf.winner, k.lf.loser);
  if (n >= 8) ranking.push(...[k.ls1.winner, k.ls2.winner].sort(byGroupRank), k.lf.winner, k.lf.loser);
  return ranking;
}

// ------------------------------------------------------------------ Dokument & Änderungen

export function createDoc({ name = '', players, config }) {
  const cfg = { ...DEFAULT_CONFIG, ...config, numPlayers: players.length };
  return {
    name,
    config: cfg,
    players: players.map((p, i) => ({ id: i + 1, ...p })),
    matches: scheduleMatches(players.length, cfg.numTVs, cfg.doubleRoundRobin),
    knockoutMatches: [],
    phase: 'group',
    winner: null,
    loser: null,
  };
}

export function groupStandings(doc) {
  return computeStandings(doc.players, doc.matches || [], doc.config?.tiebreaker);
}

export function knockoutOf(doc) {
  return resolveKnockout(groupStandings(doc), doc.config, doc.knockoutMatches || []);
}

export const allGroupPlayed = (doc) => (doc.matches || []).length > 0 && doc.matches.every(isPlayed);

/** Gesamtzustand für die Anzeige: Tabelle, K.O.-Spiele, Endrangliste. */
export function deriveState(doc) {
  const standings = groupStandings(doc);
  const knockout = doc.phase === 'group' ? [] : resolveKnockout(standings, doc.config, doc.knockoutMatches || []);
  const ranking = doc.phase === 'group' ? null : computeRanking(standings, knockout, doc.config);
  return { standings, knockout, ranking };
}

const validGoals = (v) => Number.isInteger(v) && v >= 0 && v <= 99;

/**
 * Reine Änderungsfunktionen. `applyOp` gibt immer ein neues Dokument zurück. Ungültige Eingaben
 * ändern nichts. So lassen sich lokale Änderungen nach einem Konflikt auf den Serverstand legen.
 */
export function applyOp(doc, op) {
  switch (op.type) {
    case 'groupResult': {
      if (!(op.home === null && op.away === null) && !(validGoals(op.home) && validGoals(op.away))) return doc;
      if (!doc.matches.some((m) => m.id === op.id)) return doc;
      return { ...doc, matches: doc.matches.map((m) => (m.id === op.id ? { ...m, homeGoals: op.home, awayGoals: op.away } : m)) };
    }
    case 'koResult': {
      const match = knockoutOf(doc).find((m) => m.id === op.id);
      if (!match || !match.ready) return doc;
      const clearing = op.home === null && op.away === null;
      if (!clearing && (!validGoals(op.home) || !validGoals(op.away) || op.home === op.away)) return doc;
      const rest = (doc.knockoutMatches || []).filter((s) => s.id !== op.id);
      const entry = clearing ? [] : [{ id: op.id, home: match.homePlayer, away: match.awayPlayer, homeGoals: op.home, awayGoals: op.away }];
      return { ...doc, knockoutMatches: [...rest, ...entry] };
    }
    case 'startKnockout':
      return doc.phase === 'group' && allGroupPlayed(doc) ? { ...doc, phase: 'knockout' } : doc;
    case 'backToGroup':
      return doc.phase === 'knockout' ? { ...doc, phase: 'group', knockoutMatches: [] } : doc;
    case 'finish': {
      if (doc.phase !== 'knockout') return doc;
      const { ranking } = deriveState(doc);
      if (!ranking) return doc;
      return { ...doc, phase: 'finished', winner: ranking[0], loser: ranking[ranking.length - 1] };
    }
    case 'reopen':
      return doc.phase === 'finished' ? { ...doc, phase: 'knockout', winner: null, loser: null } : doc;
    case 'renamePlayer': {
      if (!doc.players[op.index]) return doc;
      const players = doc.players.map((p, i) => (i === op.index ? { ...p, name: String(op.name).slice(0, 30), team: String(op.team ?? p.team ?? '').slice(0, 30) } : p));
      return { ...doc, players };
    }
    case 'rename':
      return { ...doc, name: String(op.name).slice(0, 60) };
    default:
      return doc;
  }
}

export const applyOps = (doc, ops) => ops.reduce(applyOp, doc);

/** Gibt true zurück, wenn eine Änderung an Gruppenergebnissen K.O.-Ergebnisse beeinflussen könnte. */
export function groupEditAffectsKnockout(doc) {
  return doc.phase !== 'group' && (doc.knockoutMatches || []).length > 0;
}

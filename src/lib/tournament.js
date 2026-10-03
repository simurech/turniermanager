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
function legPairings(n) {
  const ids = Array.from({ length: n }, (_, i) => i);
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
  // Heimrecht so verteilen, dass jeder Spieler möglichst gleich oft Heim- und Auswärtsspiele hat.
  const balance = new Array(n).fill(0);
  return pairs.map(([a, b]) => {
    const [home, away] = balance[a] <= balance[b] ? [a, b] : [b, a];
    balance[home]++;
    balance[away]--;
    return [home, away];
  });
}

/**
 * Verteilt die Paarungen auf Runden (Zeitfenster). Pro Runde spielen höchstens `numTVs`
 * Spiele gleichzeitig, kein Spieler doppelt. Es werden die Spieler bevorzugt, die am längsten pausiert haben.
 */
export function scheduleMatches(numPlayers, numTVs = 1, doubleRoundRobin = false) {
  const legs = [legPairings(numPlayers)];
  if (doubleRoundRobin) legs.push(legPairings(numPlayers).map(([h, a]) => [a, h]));

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
  return matches;
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
 * Format: Halbfinale (1-4, 2-3), Finale, optional Spiel um Platz 3. Ab 6 Spielern eine Leiter für
 * die Plätze 5 bis n: die zwei Letzten spielen, der Gewinner trifft auf den nächsthöheren Rang usw.
 * Der Verlierer des ersten Leiter-Spiels ist Letzter.
 */
export function knockoutSlots(numPlayers, config = DEFAULT_CONFIG) {
  const slots = [
    { id: 'sf1', type: 'semi', label: 'Halbfinale 1' },
    { id: 'sf2', type: 'semi', label: 'Halbfinale 2' },
    { id: 'final', type: 'final', label: 'Finale' },
  ];
  if (config.thirdPlacePlayoff) slots.push({ id: 'third', type: 'third', label: 'Spiel um Platz 3' });
  for (let k = 1; k <= numPlayers - 5; k++) {
    const lowestPlace = numPlayers - k + 1; // Platz, den der Verlierer belegt
    slots.push({ id: `lad${k}`, type: 'ladder', label: `Spiel um Platz ${lowestPlace}`, place: lowestPlace });
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

  let carry = null;
  for (let k = 1; k <= n - 5; k++) {
    const s = slot(`lad${k}`);
    const m = k === 1 ? make(s, seed(n - 2), seed(n - 1)) : make(s, carry, seed(n - k - 1));
    carry = m.winner;
  }
  return slots.map((s) => out.get(s.id));
}

/** Endrangliste (Spielerindizes von Platz 1 bis n) oder null, solange noch Spiele offen sind. */
export function computeRanking(standings, knockout, config) {
  const n = standings.length;
  if (n < 4 || knockout.some((m) => !m.done)) return null;
  const k = Object.fromEntries(knockout.map((m) => [m.id, m]));
  const ranking = [k.final.winner, k.final.loser];
  if (config.thirdPlacePlayoff) {
    ranking.push(k.third.winner, k.third.loser);
  } else {
    const rankOf = (id) => standings.findIndex((r) => r.playerId === id);
    ranking.push(...[k.sf1.loser, k.sf2.loser].sort((a, b) => rankOf(a) - rankOf(b)));
  }
  if (n === 5) ranking.push(standings[4].playerId);
  if (n >= 6) {
    ranking.push(k[`lad${n - 5}`].winner);
    for (let i = n - 5; i >= 1; i--) ranking.push(k[`lad${i}`].loser);
  }
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

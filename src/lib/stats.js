// Statistik und Spassfunktionen: Form, Direktvergleich, Computer-Tipp, Wettquoten, Hall of Fame.
// `history` ist eine Liste früherer Turnier-Dokumente (nächster Vorgänger zuerst).
import { isPlayed, computeStandings, resolveKnockout, computeRanking, knockoutOf } from './tournament.js';

export const normalizeName = (n) => String(n || '').trim().toLowerCase();

/** Alle gespielten Spiele eines Turniers als Namenspaare. Gruppenspiele nach Runde, dann K.O. */
export function playedMatches(doc) {
  const name = (i) => doc.players?.[i]?.name ?? '';
  const group = (doc.matches || [])
    .filter(isPlayed)
    .sort((a, b) => a.round - b.round || a.tv - b.tv)
    .map((m) => ({ home: name(m.homePlayer), away: name(m.awayPlayer), hg: m.homeGoals, ag: m.awayGoals, ko: false }));
  const ko = doc.phase === 'group' ? [] : knockoutOf(doc).filter((m) => m.done);
  return [...group, ...ko.map((m) => ({ home: name(m.homePlayer), away: name(m.awayPlayer), hg: m.homeGoals, ag: m.awayGoals, ko: true }))];
}

function resultFor(match, key) {
  const isHome = normalizeName(match.home) === key;
  const isAway = normalizeName(match.away) === key;
  if (!isHome && !isAway) return null;
  const gf = isHome ? match.hg : match.ag;
  const ga = isHome ? match.ag : match.hg;
  return { gf, ga, r: gf > ga ? 'W' : gf < ga ? 'L' : 'D' };
}

/** Form im aktuellen Turnier: letzte Ergebnisse, aktuelle Serie und Punkte der letzten Spiele. */
export function playerForm(doc, playerIndex, limit = 5) {
  const key = normalizeName(doc.players[playerIndex]?.name);
  const results = playedMatches(doc)
    .map((m) => resultFor(m, key))
    .filter(Boolean);
  const last = results.slice(-limit);
  let streak = { type: null, count: 0 };
  for (let i = results.length - 1; i >= 0; i--) {
    if (streak.type === null) streak = { type: results[i].r, count: 1 };
    else if (results[i].r === streak.type) streak.count++;
    else break;
  }
  return {
    results: last.map((x) => x.r),
    streak,
    points: last.reduce((s, x) => s + (x.r === 'W' ? 3 : x.r === 'D' ? 1 : 0), 0),
    goalDiff: last.reduce((s, x) => s + x.gf - x.ga, 0),
  };
}

export function streakLabel(streak) {
  if (!streak.type || streak.count < 2) return '';
  const word = { W: 'Siege', D: 'Remis', L: 'Niederlagen' }[streak.type];
  return `${streak.count} ${word} in Folge`;
}

/** Bilanz zweier Spieler aus allen bekannten Turnieren (aktuell und Vorgänger). */
export function headToHead(docs, nameA, nameB) {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  const out = { games: 0, winsA: 0, winsB: 0, draws: 0, goalsA: 0, goalsB: 0 };
  for (const doc of docs) {
    for (const m of playedMatches(doc)) {
      const ra = resultFor(m, a);
      const rb = resultFor(m, b);
      if (!ra || !rb || normalizeName(m.home) === normalizeName(m.away)) continue;
      out.games++;
      out.goalsA += ra.gf;
      out.goalsB += rb.gf;
      if (ra.r === 'W') out.winsA++;
      else if (ra.r === 'L') out.winsB++;
      else out.draws++;
    }
  }
  return out;
}

// ------------------------------------------------------------------ Stärke und Tipp

const PRIOR_WEIGHT = 4; // Wie stark der Durchschnitt bei wenig Daten zieht
const HISTORY_WEIGHT = 0.6; // Vorjahre zählen weniger, jedes weitere Jahr nochmals weniger

/** Schätzt Angriff und Abwehr pro Spieler aus aktuellen und früheren Turnieren. */
export function buildStrength(doc, history = []) {
  const stats = new Map();
  let goals = 0;
  let games = 0;
  let weightedGames = 0;
  const add = (name, gf, ga, w) => {
    const s = stats.get(name) || { gf: 0, ga: 0, n: 0 };
    s.gf += gf * w;
    s.ga += ga * w;
    s.n += w;
    stats.set(name, s);
  };
  [doc, ...history].forEach((d, idx) => {
    const w = idx === 0 ? 1 : HISTORY_WEIGHT / idx;
    for (const m of playedMatches(d)) {
      add(normalizeName(m.home), m.hg, m.ag, w);
      add(normalizeName(m.away), m.ag, m.hg, w);
      goals += m.hg + m.ag;
      games++;
      weightedGames += w;
    }
  });
  const mu = games ? goals / (games * 2) : 2;
  const rate = (name, field) => {
    const s = stats.get(normalizeName(name)) || { gf: 0, ga: 0, n: 0 };
    return (s[field] + PRIOR_WEIGHT * mu) / (s.n + PRIOR_WEIGHT);
  };
  const clamp = (x) => Math.min(6, Math.max(0.3, x));
  return {
    mu,
    games,
    confidence: Math.min(1, weightedGames / Math.max(6, (doc.players?.length || 6) * 2)),
    expected: (home, away) => [clamp((rate(home, 'gf') + rate(away, 'ga')) / 2), clamp((rate(away, 'gf') + rate(home, 'ga')) / 2)],
  };
}

function poissonPmf(lambda, max) {
  const p = [Math.exp(-lambda)];
  for (let k = 1; k <= max; k++) p.push((p[k - 1] * lambda) / k);
  return p;
}

/** Wahrscheinlichkeiten und wahrscheinlichstes Resultat aus zwei Poisson-Verteilungen. */
export function predictMatch(strength, home, away) {
  const [lh, la] = strength.expected(home, away);
  const max = 10;
  const ph = poissonPmf(lh, max);
  const pa = poissonPmf(la, max);
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let best = { p: -1, score: [0, 0] };
  for (let i = 0; i <= max; i++) {
    for (let j = 0; j <= max; j++) {
      const p = ph[i] * pa[j];
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      if (p > best.p) best = { p, score: [i, j] };
    }
  }
  const total = pHome + pDraw + pAway;
  return { pHome: pHome / total, pDraw: pDraw / total, pAway: pAway / total, score: best.score, expected: [lh, la] };
}

/** Das nächste offene Gruppenspiel (kleinste Runde, dann TV) oder null. */
export function nextGroupMatch(doc) {
  return (doc.matches || []).filter((m) => !isPlayed(m)).sort((a, b) => a.round - b.round || a.tv - b.tv)[0] || null;
}

export function tipText(doc, history, match) {
  const strength = buildStrength(doc, history);
  const home = doc.players[match.homePlayer]?.name;
  const away = doc.players[match.awayPlayer]?.name;
  const p = predictMatch(strength, home, away);
  const [hs, as] = p.score;
  const pct = (x) => Math.round(x * 100);
  const favourite = p.pHome >= p.pAway ? [home, p.pHome] : [away, p.pAway];
  const verdict = Math.abs(p.pHome - p.pAway) < 0.08 ? 'Offenes Spiel' : `${favourite[0]} ist Favorit`;
  return { home, away, score: `${hs}:${as}`, pHome: pct(p.pHome), pDraw: pct(p.pDraw), pAway: pct(p.pAway), verdict, confidence: strength.confidence };
}

// ------------------------------------------------------------------ Wettquoten (Simulation)

export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePoisson(lambda, rng) {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

function simulateOnce(doc, strength, rng) {
  const name = (i) => doc.players[i].name;
  const play = (home, away) => {
    const [lh, la] = strength.expected(name(home), name(away));
    return [samplePoisson(lh, rng), samplePoisson(la, rng)];
  };
  const matches = doc.matches.map((m) => {
    if (isPlayed(m)) return m;
    const [h, a] = play(m.homePlayer, m.awayPlayer);
    return { ...m, homeGoals: h, awayGoals: a };
  });
  const standings = computeStandings(doc.players, matches, doc.config.tiebreaker);
  const stored = doc.phase === 'group' ? [] : [...(doc.knockoutMatches || [])];
  for (let guard = 0; guard < 20; guard++) {
    const ko = resolveKnockout(standings, doc.config, stored);
    const next = ko.find((m) => m.ready && !m.done);
    if (!next) break;
    let [h, a] = play(next.homePlayer, next.awayPlayer);
    if (h === a) {
      // Unentschieden gibt es im K.O. nicht: Verlängerung/Penalty als Münzwurf nach Stärke
      const p = predictMatch(strength, name(next.homePlayer), name(next.awayPlayer));
      if (rng() < p.pHome / (p.pHome + p.pAway)) h++;
      else a++;
    }
    stored.push({ id: next.id, home: next.homePlayer, away: next.awayPlayer, homeGoals: h, awayGoals: a });
  }
  const ko = resolveKnockout(standings, doc.config, stored);
  return computeRanking(standings, ko, doc.config);
}

/** Wahrscheinlichkeit pro Spieler für Turniersieg und letzten Platz (Monte-Carlo). */
export function simulateOutcomes(doc, history = [], runs = 1500, rng = Math.random) {
  const n = doc.players.length;
  if (n < 4) return null;
  const strength = buildStrength(doc, history);
  const champion = new Array(n).fill(0);
  const last = new Array(n).fill(0);
  let valid = 0;
  for (let i = 0; i < runs; i++) {
    const ranking = simulateOnce(doc, strength, rng);
    if (!ranking) continue;
    valid++;
    champion[ranking[0]]++;
    last[ranking[n - 1]]++;
  }
  if (!valid) return null;
  return {
    confidence: strength.confidence,
    players: doc.players.map((_, i) => ({ index: i, champion: champion[i] / valid, last: last[i] / valid })),
  };
}

/** Wettquote aus Wahrscheinlichkeit mit Wettanbieter-Marge. */
export function quote(probability, margin = 0.92) {
  if (!(probability > 0.004)) return null;
  return Math.max(1.05, Math.round((margin / probability) * 10) / 10);
}

// ------------------------------------------------------------------ Hall of Fame

/** Ewige Tabelle über alle abgeschlossenen Turniere. Spieler werden über den Namen erkannt. */
export function hallOfFame(docs) {
  const table = new Map();
  const entry = (name) => {
    const key = normalizeName(name);
    if (!table.has(key)) {
      table.set(key, { key, name, tournaments: 0, titles: 0, lastPlaces: 0, played: 0, won: 0, draw: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
    }
    return table.get(key);
  };
  // Älteste zuerst, damit der Anzeigename vom neuesten Turnier stammt
  [...docs].reverse().forEach((doc) => {
    doc.players.forEach((p) => {
      const e = entry(p.name);
      e.name = p.name;
      e.tournaments++;
    });
    if (doc.phase === 'finished') {
      if (doc.players[doc.winner]) entry(doc.players[doc.winner].name).titles++;
      if (doc.players[doc.loser]) entry(doc.players[doc.loser].name).lastPlaces++;
    }
    for (const m of playedMatches(doc)) {
      for (const [who, gf, ga] of [[m.home, m.hg, m.ag], [m.away, m.ag, m.hg]]) {
        const e = entry(who);
        e.played++;
        e.goalsFor += gf;
        e.goalsAgainst += ga;
        if (gf > ga) e.won++;
        else if (gf < ga) e.lost++;
        else e.draw++;
      }
    }
  });
  return [...table.values()]
    .map((e) => ({ ...e, winRate: e.played ? e.won / e.played : 0, goalDiff: e.goalsFor - e.goalsAgainst }))
    .sort((a, b) => b.titles - a.titles || b.winRate - a.winRate || a.name.localeCompare(b.name, 'de'));
}

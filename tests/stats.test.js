import { describe, it, expect } from 'vitest';
import { createDoc, applyOp, applyOps } from '../src/lib/tournament.js';
import {
  playerForm,
  streakLabel,
  headToHead,
  buildStrength,
  predictMatch,
  simulateOutcomes,
  seededRandom,
  quote,
  hallOfFame,
  nextGroupMatch,
  tipText,
  playedMatches,
  roundPercents,
  nextMatches,
  preTournamentOdds,
  computeOdds,
  hashString,
} from '../src/lib/stats.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ name: ['Marco', 'Simon', 'Luca', 'Dani', 'Jonas', 'Nico', 'Reto'][i], team: '' }));
const fresh = (n = 7) => createDoc({ name: 'T', players: players(n), config: {} });

/** Spielt alle Gruppenspiele mit einer Ergebnisfunktion. */
const playGroup = (doc, fn) => applyOps(doc, doc.matches.map((m) => ({ type: 'groupResult', id: m.id, ...fn(m) })));

// Marco (0) gewinnt immer 3:0, alle anderen spielen 1:1
const marcoWins = (m) => (m.homePlayer === 0 ? { home: 3, away: 0 } : m.awayPlayer === 0 ? { home: 0, away: 3 } : { home: 1, away: 1 });

describe('Form', () => {
  it('liefert Ergebnisse, Serie und Label', () => {
    const doc = playGroup(fresh(), marcoWins);
    const f = playerForm(doc, 0);
    expect(f.results).toEqual(['W', 'W', 'W', 'W', 'W']);
    expect(f.streak).toEqual({ type: 'W', count: 6 });
    expect(streakLabel(f.streak)).toBe('6 Siege in Folge');
    expect(playerForm(doc, 1).results.every((r) => r === 'D' || r === 'L')).toBe(true);
  });

  it('ohne gespielte Spiele leer', () => {
    const f = playerForm(fresh(), 0);
    expect(f.results).toEqual([]);
    expect(streakLabel(f.streak)).toBe('');
  });

  it('berücksichtigt nur die letzten 5', () => {
    const doc = playGroup(fresh(), marcoWins);
    expect(playerForm(doc, 0, 3).results).toHaveLength(3);
  });
});

describe('Direktvergleich', () => {
  it('zählt Siege, Remis und Tore über mehrere Turniere, Namen ohne Gross-/Kleinschreibung', () => {
    const a = playGroup(fresh(), marcoWins);
    const b = createDoc({ name: 'Vorjahr', players: players(7).map((p) => (p.name === 'Marco' ? { ...p, name: ' marco ' } : p)), config: {} });
    const prev = playGroup(b, (m) => (m.homePlayer === 0 ? { home: 0, away: 2 } : m.awayPlayer === 0 ? { home: 2, away: 0 } : { home: 1, away: 1 }));
    const r = headToHead([a, prev], 'Marco', 'Simon');
    expect(r.games).toBe(2);
    expect(r.winsA).toBe(1);
    expect(r.winsB).toBe(1);
    expect(r.draws).toBe(0);
  });
});

describe('Tipp', () => {
  it('Wahrscheinlichkeiten ergeben 100 % und ohne Daten gilt Gleichstand der Stärke', () => {
    const doc = fresh();
    const s = buildStrength(doc, []);
    const p = predictMatch(s, 'Marco', 'Simon');
    expect(p.pHome + p.pDraw + p.pAway).toBeCloseTo(1, 6);
    expect(p.pHome).toBeCloseTo(p.pAway, 6);
    expect(s.confidence).toBe(0);
  });

  it('stärkerer Spieler ist Favorit', () => {
    const doc = playGroup(fresh(), marcoWins);
    const p = predictMatch(buildStrength(doc, []), 'Marco', 'Simon');
    expect(p.pHome).toBeGreaterThan(p.pAway);
    expect(p.score[0]).toBeGreaterThan(p.score[1]);
  });

  it('Vorjahresdaten fliessen ein, aber schwächer', () => {
    const prev = playGroup(fresh(), marcoWins);
    const none = predictMatch(buildStrength(fresh(), []), 'Marco', 'Simon').pHome;
    const withHist = predictMatch(buildStrength(fresh(), [prev]), 'Marco', 'Simon').pHome;
    const current = predictMatch(buildStrength(prev, []), 'Marco', 'Simon').pHome;
    expect(withHist).toBeGreaterThan(none);
    expect(withHist).toBeLessThan(current);
  });

  it('nextGroupMatch und tipText', () => {
    let doc = fresh();
    const first = nextGroupMatch(doc);
    expect(first.round).toBe(1);
    doc = applyOp(doc, { type: 'groupResult', id: first.id, home: 1, away: 0 });
    expect(nextGroupMatch(doc).id).not.toBe(first.id);
    const tip = tipText(doc, [], nextGroupMatch(doc));
    expect(tip.score).toMatch(/^\d+:\d+$/);
    expect(tip.pHome + tip.pDraw + tip.pAway).toBeGreaterThanOrEqual(99);
  });

  it('playedMatches sortiert nach Runde', () => {
    const doc = playGroup(fresh(), marcoWins);
    expect(playedMatches(doc)).toHaveLength(21);
  });
});

describe('Wettquoten', () => {
  it('ohne Daten sind alle Spieler etwa gleich wahrscheinlich', () => {
    const r = simulateOutcomes(fresh(), [], 1400, seededRandom(1));
    const probs = r.players.map((p) => p.champion);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(r.players.reduce((s, p) => s + p.last, 0)).toBeCloseTo(1, 6);
    // 7 Spieler, K.O. nur für 4: Gleichstärke ergibt je ca. 14 %, mit Streuung
    for (const p of probs) expect(p).toBeGreaterThan(0.05);
    for (const p of probs) expect(p).toBeLessThan(0.28);
  });

  it('der dominante Spieler hat die höchste Titelchance und die kleinste Quote', () => {
    let doc = fresh();
    const half = doc.matches.slice(0, 12);
    doc = applyOps(doc, half.map((m) => ({ type: 'groupResult', id: m.id, ...marcoWins(m) })));
    const r = simulateOutcomes(doc, [], 1500, seededRandom(7));
    const best = [...r.players].sort((a, b) => b.champion - a.champion)[0];
    expect(best.index).toBe(0);
    expect(quote(best.champion)).toBeLessThan(quote(r.players[3].champion) ?? 99);
  });

  it('abgeschlossene Gruppenphase und K.O.: bekannte Ergebnisse bleiben bestehen', () => {
    let doc = playGroup(fresh(), marcoWins);
    doc = applyOp(doc, { type: 'startKnockout' });
    doc = applyOp(doc, { type: 'koResult', id: 'sf1', home: 5, away: 0 });
    doc = applyOp(doc, { type: 'koResult', id: 'sf2', home: 0, away: 4 });
    const r = simulateOutcomes(doc, [], 400, seededRandom(3));
    expect(r.players.reduce((s, p) => s + p.champion, 0)).toBeCloseTo(1, 6);
    // Finale steht fest, also haben höchstens zwei Spieler eine Titelchance
    expect(r.players.filter((p) => p.champion > 0)).toHaveLength(2);
  });

  it('quote(): Marge, Untergrenze, kein Preis bei null', () => {
    expect(quote(0.5)).toBe(1.8);
    expect(quote(0.95)).toBe(1.05);
    expect(quote(0)).toBeNull();
    expect(quote(0.001)).toBeNull();
  });

  it('weniger als 4 Spieler: keine Simulation', () => {
    expect(simulateOutcomes({ players: players(3), matches: [], config: {} }, [])).toBeNull();
  });
});

describe('Hall of Fame', () => {
  it('zählt Titel und letzte Plätze nach Namen', () => {
    const finish = (doc) => {
      let d = playGroup(doc, marcoWins);
      d = applyOp(d, { type: 'startKnockout' });
      for (const id of ['sf1', 'sf2', 'final', 'third', 'ls1', 'lf']) d = applyOp(d, { type: 'koResult', id, home: 2, away: 1 });
      return applyOp(d, { type: 'finish' });
    };
    const a = finish(fresh());
    const b = finish(createDoc({ name: 'B', players: players(7).map((p) => ({ ...p, name: p.name.toUpperCase() })), config: {} }));
    expect(a.phase).toBe('finished');
    const table = hallOfFame([b, a]);
    const marco = table.find((e) => e.key === 'marco');
    expect(marco.tournaments).toBe(2);
    expect(marco.titles).toBe(2);
    expect(table[0].key).toBe('marco');
    expect(marco.name).toBe('MARCO'); // Name vom neuesten (ersten) Turnier der Liste
    expect(table.reduce((s, e) => s + e.lastPlaces, 0)).toBe(2);
    expect(marco.winRate).toBeGreaterThan(0.5);
  });
});

describe('Prozente, parallele Spiele und neutrale Quoten', () => {
  it('roundPercents ergibt immer genau 100', () => {
    expect(roundPercents([0.4, 0.4, 0.205])).toEqual([40, 40, 20]);
    expect(roundPercents([1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + b, 0)).toBe(100);
    const rng = seededRandom(5);
    for (let i = 0; i < 500; i++) {
      const a = rng();
      const b = rng() * (1 - a);
      const values = [a, b, 1 - a - b];
      expect(roundPercents(values).reduce((x, y) => x + y, 0)).toBe(100);
    }
  });

  it('Tipp zeigt Prozente, die sich auf 100 summieren', () => {
    let doc = fresh();
    for (let i = 0; i < 12; i++) {
      const tip = tipText(doc, [], nextGroupMatch(doc));
      expect(tip.pHome + tip.pDraw + tip.pAway).toBe(100);
      doc = applyOp(doc, { type: 'groupResult', id: nextGroupMatch(doc).id, home: i % 4, away: (i * 3) % 3 });
    }
  });

  it('gleich starke Spieler bekommen im Tipp gleiche Prozente', () => {
    const doc = fresh();
    const tip = tipText(doc, [], nextGroupMatch(doc));
    expect(tip.pHome).toBe(tip.pAway);
    expect(tip.pHome + tip.pDraw + tip.pAway).toBe(100);
  });

  it('bei 2 Fernsehern werden beide gleichzeitigen Spiele angezeigt', () => {
    const two = createDoc({ name: 'T', players: players(7), config: { numTVs: 2 } });
    const next = nextMatches(two);
    expect(next).toHaveLength(2);
    expect(next[0].round).toBe(next[1].round);
    expect(next.map((m) => m.tv)).toEqual([1, 2]);
    expect(nextMatches(fresh())).toHaveLength(1);
  });

  it('nextMatches rückt nach, sobald beide Spiele einer Runde gespielt sind', () => {
    let doc = createDoc({ name: 'T', players: players(7), config: { numTVs: 2 } });
    const first = nextMatches(doc);
    doc = applyOps(doc, first.map((m) => ({ type: 'groupResult', id: m.id, home: 1, away: 0 })));
    expect(nextMatches(doc)[0].round).toBe(first[0].round + 1);
  });

  it('K.O.: beide bereiten Halbfinals laufen parallel (2 TV), sonst eines', () => {
    const run = (tvs) => {
      let d = createDoc({ name: 'T', players: players(7), config: { numTVs: tvs } });
      d = playGroup(d, marcoWins);
      return applyOp(d, { type: 'startKnockout' });
    };
    expect(nextMatches(run(2)).map((m) => m.id)).toEqual(['sf1', 'sf2']);
    expect(nextMatches(run(1)).map((m) => m.id)).toEqual(['sf1']);
  });

  it('vor dem ersten Spiel sind alle Quoten gleich, nur Meister und Verlierer weichen ab', () => {
    const doc = fresh();
    const equal = preTournamentOdds(doc);
    expect(new Set(equal.map((p) => p.champion.toFixed(9))).size).toBe(1);
    expect(new Set(equal.map((p) => p.last.toFixed(9))).size).toBe(1);

    const marked = { ...doc, players: doc.players.map((p, i) => ({ ...p, champion: i === 0, loserMark: i === 6 })) };
    const odds = preTournamentOdds(marked);
    expect(odds.reduce((s, p) => s + p.champion, 0)).toBeCloseTo(1, 9);
    expect(odds.reduce((s, p) => s + p.last, 0)).toBeCloseTo(1, 9);
    expect(odds[0].champion).toBeGreaterThan(odds[3].champion); // Titelverteidiger eher Sieger
    expect(odds[0].last).toBeLessThan(odds[3].last); // und seltener Letzter
    expect(odds[6].last).toBeGreaterThan(odds[3].last); // Vorjahres-Verlierer eher wieder Letzter
    expect(odds[6].champion).toBeLessThan(odds[3].champion);
    expect(odds[1].champion).toBeCloseTo(odds[3].champion, 9);
  });

  it('computeOdds ohne gespieltes Spiel ist unabhängig vom Zufall und von den Vorjahren', () => {
    const prev = playGroup(fresh(), marcoWins);
    const a = computeOdds(fresh(), [prev], 500, seededRandom(1));
    const b = computeOdds(fresh(), [], 500, seededRandom(999));
    expect(a.confidence).toBe(0);
    expect(a.players).toEqual(b.players);
    expect(new Set(a.players.map((p) => p.champion.toFixed(9))).size).toBe(1);
  });

  it('mit gespielten Spielen fliesst die Simulation schrittweise ein', () => {
    let doc = fresh();
    doc = applyOps(doc, doc.matches.slice(0, 3).map((m) => ({ type: 'groupResult', id: m.id, ...marcoWins(m) })));
    const early = computeOdds(doc, [], 800, seededRandom(2));
    expect(early.confidence).toBeCloseTo(3 / 14, 6);
    const full = applyOps(fresh(), fresh().matches.slice(0, 14).map((m) => ({ type: 'groupResult', id: m.id, ...marcoWins(m) })));
    const later = computeOdds(full, [], 800, seededRandom(2));
    expect(later.confidence).toBe(1);
    const sum = (o, k) => o.players.reduce((s, p) => s + p[k], 0);
    expect(sum(early, 'champion')).toBeCloseTo(1, 6);
    expect(sum(later, 'last')).toBeCloseTo(1, 6);
    const best = [...later.players].sort((x, y) => y.champion - x.champion)[0];
    expect(best.index).toBe(0);
  });

  it('gleicher Spielstand ergibt mit demselben Seed dieselben Quoten', () => {
    let doc = fresh();
    doc = applyOps(doc, doc.matches.slice(0, 6).map((m) => ({ type: 'groupResult', id: m.id, ...marcoWins(m) })));
    const seed = hashString('stand-a');
    expect(computeOdds(doc, [], 600, seededRandom(seed))).toEqual(computeOdds(doc, [], 600, seededRandom(seed)));
  });
});

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
      for (const id of ['sf1', 'sf2', 'final', 'third', 'lad1', 'lad2']) d = applyOp(d, { type: 'koResult', id, home: 2, away: 1 });
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

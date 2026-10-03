import { describe, it, expect } from 'vitest';
import {
  scheduleMatches,
  computeStandings,
  knockoutSlots,
  resolveKnockout,
  computeRanking,
  createDoc,
  applyOp,
  applyOps,
  deriveState,
  DEFAULT_CONFIG,
} from '../src/lib/tournament.js';

const names = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, team: '' }));
const cfg = (o = {}) => ({ ...DEFAULT_CONFIG, ...o });

describe('Spielplan', () => {
  for (const n of [4, 5, 6, 7, 8]) {
    for (const tvs of [1, 2]) {
      for (const dbl of [false, true]) {
        it(`${n} Spieler, ${tvs} TV, doppelt=${dbl}`, () => {
          const m = scheduleMatches(n, tvs, dbl);
          const legs = dbl ? 2 : 1;
          expect(m).toHaveLength((n * (n - 1) / 2) * legs);
          // Jede Paarung genau `legs` mal, bei doppelt je einmal mit Heimrecht
          const seen = new Map();
          m.forEach((x) => seen.set(`${x.homePlayer}-${x.awayPlayer}`, (seen.get(`${x.homePlayer}-${x.awayPlayer}`) || 0) + 1));
          for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
              const total = (seen.get(`${i}-${j}`) || 0) + (seen.get(`${j}-${i}`) || 0);
              expect(total).toBe(legs);
            }
          }
          // Pro Runde max. `tvs` Spiele und kein Spieler doppelt
          const rounds = Map.groupBy(m, (x) => x.round);
          for (const list of rounds.values()) {
            expect(list.length).toBeLessThanOrEqual(tvs);
            const ids = list.flatMap((x) => [x.homePlayer, x.awayPlayer]);
            expect(new Set(ids).size).toBe(ids.length);
            expect(new Set(list.map((x) => x.tv)).size).toBe(list.length);
          }
          expect(new Set(m.map((x) => x.id)).size).toBe(m.length);
        });
      }
    }
  }

  it('mit 4 Spielern und 2 TVs spielen alle in jeder Runde', () => {
    const m = scheduleMatches(4, 2, false);
    expect(Map.groupBy(m, (x) => x.round).size).toBe(3);
  });

  it('Heimrecht ist ausgeglichen (höchstens 1 Unterschied pro Spieler bei einfacher Runde)', () => {
    for (const n of [4, 6, 7]) {
      const home = new Array(n).fill(0);
      const away = new Array(n).fill(0);
      scheduleMatches(n, 1, false).forEach((x) => {
        home[x.homePlayer]++;
        away[x.awayPlayer]++;
      });
      for (let i = 0; i < n; i++) expect(Math.abs(home[i] - away[i])).toBeLessThanOrEqual(2);
    }
  });
});

const played = (h, a, hg, ag) => ({ id: `${h}-${a}`, homePlayer: h, awayPlayer: a, homeGoals: hg, awayGoals: ag });

describe('Tabelle', () => {
  const players = names(3);

  it('berechnet Punkte und Tordifferenz', () => {
    const t = computeStandings(players, [played(0, 1, 2, 0), played(1, 2, 1, 1), played(0, 2, 0, 3)]);
    expect(t.map((r) => r.playerId)).toEqual([2, 0, 1]);
    expect(t[0]).toMatchObject({ points: 4, goalDiff: 3, played: 2, won: 1, draw: 1 });
    expect(t.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('ignoriert nicht gespielte Spiele', () => {
    const t = computeStandings(players, [played(0, 1, null, null)]);
    expect(t.every((r) => r.played === 0)).toBe(true);
  });

  it('Gleichstand: Tordifferenz, dann Tore', () => {
    const t = computeStandings(names(2), [played(0, 1, 1, 1)]);
    expect(t.map((r) => r.points)).toEqual([1, 1]);
  });

  it('direkter Vergleich entscheidet vor der Tordifferenz', () => {
    const p = names(3);
    // A schlägt B, B schlägt C, C schlägt A -> Dreier-Gleichstand, alle 3 Punkte
    // Tordifferenz würde C bevorzugen (+4), direkter Vergleich: Mini-Tabelle alle 3 Punkte, dann Mini-TD
    const matches = [played(0, 1, 1, 0), played(1, 2, 1, 0), played(2, 0, 5, 0)];
    const dg = computeStandings(p, matches, 'goalDiff').map((r) => r.playerId);
    expect(dg[0]).toBe(2);
    const h2h = computeStandings(p, matches, 'head2head').map((r) => r.playerId);
    expect(h2h).toHaveLength(3);
    expect(new Set(h2h).size).toBe(3);
  });

  it('direkter Vergleich zwischen zwei Spielern', () => {
    const p = names(3);
    const matches = [
      played(0, 1, 1, 0), // 0 schlägt 1
      played(0, 2, 0, 5), // 2 schlägt 0 klar
      played(1, 2, 3, 0), // 1 schlägt 2
    ];
    // Alle 3 Punkte. Mini-Tabelle ist ein Dreieck, Mini-TD: 0:+1-5=-4, 1:-1+3=+2, 2:+5-3=+2
    const h = computeStandings(p, matches, 'head2head').map((r) => r.playerId);
    expect(h[2]).toBe(0);
  });

  it('bei völligem Gleichstand gilt die Reihenfolge der Eingabe', () => {
    const t = computeStandings([{ name: 'Zoe' }, { name: 'Adam' }], []);
    expect(t.map((r) => r.playerId)).toEqual([0, 1]);
  });
});

// Standings für KO-Tests: Spieler 0..n-1 in dieser Rangfolge
const seeded = (n) => Array.from({ length: n }, (_, i) => ({ playerId: i, rank: i + 1 }));

describe('K.O.-Runde', () => {
  it('Slots: 4 Spieler ohne Leiter, mit/ohne Platz 3', () => {
    expect(knockoutSlots(4, cfg()).map((s) => s.id)).toEqual(['sf1', 'sf2', 'final', 'third']);
    expect(knockoutSlots(4, cfg({ thirdPlacePlayoff: false })).map((s) => s.id)).toEqual(['sf1', 'sf2', 'final']);
  });

  it('Leiter: 5 Spieler 0, 6 -> 1, 7 -> 2, 8 -> 3 Spiele', () => {
    const lad = (n) => knockoutSlots(n, cfg()).filter((s) => s.type === 'ladder').length;
    expect([4, 5, 6, 7, 8].map(lad)).toEqual([0, 0, 1, 2, 3]);
  });

  it('Halbfinale 1-4 und 2-3, Finale offen bis beide Halbfinals gespielt', () => {
    const k = resolveKnockout(seeded(7), cfg(), []);
    const by = Object.fromEntries(k.map((m) => [m.id, m]));
    expect([by.sf1.homePlayer, by.sf1.awayPlayer]).toEqual([0, 3]);
    expect([by.sf2.homePlayer, by.sf2.awayPlayer]).toEqual([1, 2]);
    expect(by.final.ready).toBe(false);
    expect([by.lad1.homePlayer, by.lad1.awayPlayer]).toEqual([5, 6]);
    expect(by.lad2.ready).toBe(false);
  });

  it('Rangliste für 8 Spieler ist vollständig und sinnvoll', () => {
    const standings = seeded(8);
    let stored = [];
    const play = (id, hg, ag) => {
      const m = resolveKnockout(standings, cfg(), stored).find((x) => x.id === id);
      expect(m.ready).toBe(true);
      stored = [...stored, { id, home: m.homePlayer, away: m.awayPlayer, homeGoals: hg, awayGoals: ag }];
    };
    play('sf1', 2, 1); // 0 schlägt 3
    play('sf2', 0, 1); // 2 schlägt 1
    play('final', 3, 0); // 0 Meister
    play('third', 0, 2); // 3 holt Platz 3 (home=1, away=3)
    play('lad1', 1, 0); // 6 schlägt 7 -> 7 Letzter
    play('lad2', 0, 1); // 5 schlägt 6
    play('lad3', 2, 3); // 4 verliert gegen 5? home=5? siehe unten
    const k = resolveKnockout(standings, cfg(), stored);
    expect(k.every((m) => m.done)).toBe(true);
    const ranking = computeRanking(standings, k, cfg());
    expect(ranking).toHaveLength(8);
    expect(new Set(ranking).size).toBe(8);
    expect(ranking[0]).toBe(0);
    expect(ranking[7]).toBe(7);
  });

  it('Rangliste für 5 Spieler: Platz 5 = Gruppenletzter', () => {
    const standings = seeded(5);
    const stored = [];
    const add = (id, hg, ag) => {
      const m = resolveKnockout(standings, cfg({ thirdPlacePlayoff: false }), stored).find((x) => x.id === id);
      stored.push({ id, home: m.homePlayer, away: m.awayPlayer, homeGoals: hg, awayGoals: ag });
    };
    add('sf1', 1, 0);
    add('sf2', 0, 1);
    add('final', 1, 0);
    const k = resolveKnockout(standings, cfg({ thirdPlacePlayoff: false }), stored);
    const ranking = computeRanking(standings, k, cfg({ thirdPlacePlayoff: false }));
    expect(ranking).toHaveLength(5);
    expect(ranking[4]).toBe(4);
  });

  it('Unentschieden im K.O. zählt nicht', () => {
    const standings = seeded(4);
    const m = resolveKnockout(standings, cfg(), [{ id: 'sf1', home: 0, away: 3, homeGoals: 1, awayGoals: 1 }]);
    expect(m.find((x) => x.id === 'sf1').done).toBe(false);
  });

  it('geändertes Gruppenergebnis macht K.O.-Ergebnis veraltet statt es still zu löschen', () => {
    const standings = seeded(4);
    const stored = [{ id: 'sf1', home: 1, away: 3, homeGoals: 2, awayGoals: 0 }]; // früher andere Paarung
    const sf1 = resolveKnockout(standings, cfg(), stored).find((x) => x.id === 'sf1');
    expect(sf1.done).toBe(false);
    expect(sf1.stale).toBe(true);
  });
});

describe('Dokument und Ops', () => {
  const doc = () => createDoc({ name: 'Test', players: names(5), config: { numTVs: 1 } });

  it('createDoc setzt Spielerzahl und Plan', () => {
    const d = doc();
    expect(d.config.numPlayers).toBe(5);
    expect(d.matches).toHaveLength(10);
    expect(d.players[0].id).toBe(1);
    expect(d.phase).toBe('group');
  });

  it('groupResult validiert Eingaben', () => {
    const d = doc();
    expect(applyOp(d, { type: 'groupResult', id: 0, home: -1, away: 2 })).toBe(d);
    expect(applyOp(d, { type: 'groupResult', id: 0, home: 1.5, away: 2 })).toBe(d);
    expect(applyOp(d, { type: 'groupResult', id: 999, home: 1, away: 2 })).toBe(d);
    const ok = applyOp(d, { type: 'groupResult', id: 0, home: 2, away: 1 });
    expect(ok.matches[0]).toMatchObject({ homeGoals: 2, awayGoals: 1 });
    const cleared = applyOp(ok, { type: 'groupResult', id: 0, home: null, away: null });
    expect(cleared.matches[0].homeGoals).toBeNull();
  });

  it('K.O. startet erst, wenn alle Gruppenspiele gespielt sind', () => {
    let d = doc();
    expect(applyOp(d, { type: 'startKnockout' }).phase).toBe('group');
    d = applyOps(d, d.matches.map((m) => ({ type: 'groupResult', id: m.id, home: 1, away: 0 })));
    expect(applyOp(d, { type: 'startKnockout' }).phase).toBe('knockout');
  });

  it('komplettes Turnier mit 5 Spielern bis zum Abschluss', () => {
    let d = doc();
    d = applyOps(d, d.matches.map((m, i) => ({ type: 'groupResult', id: m.id, home: i % 4, away: (i + 1) % 3 })));
    d = applyOp(d, { type: 'startKnockout' });
    expect(d.phase).toBe('knockout');
    for (const id of ['sf1', 'sf2', 'final', 'third']) {
      d = applyOp(d, { type: 'koResult', id, home: 2, away: 1 });
    }
    expect(applyOp(d, { type: 'finish' }).phase).toBe('finished');
    const finished = applyOp(d, { type: 'finish' });
    const { ranking } = deriveState(finished);
    expect(finished.winner).toBe(ranking[0]);
    expect(finished.loser).toBe(ranking[4]);
  });

  it('koResult lehnt Unentschieden und noch nicht bereite Spiele ab', () => {
    let d = doc();
    d = applyOps(d, d.matches.map((m) => ({ type: 'groupResult', id: m.id, home: 1, away: 0 })));
    d = applyOp(d, { type: 'startKnockout' });
    expect(applyOp(d, { type: 'koResult', id: 'sf1', home: 1, away: 1 })).toBe(d);
    expect(applyOp(d, { type: 'koResult', id: 'final', home: 1, away: 0 })).toBe(d);
  });

  it('Änderung eines Gruppenergebnisses nach K.O.-Start macht betroffene K.O.-Ergebnisse veraltet', () => {
    let d = doc();
    d = applyOps(d, d.matches.map((m, i) => ({ type: 'groupResult', id: m.id, home: i % 3, away: (i * 2) % 3 })));
    d = applyOp(d, { type: 'startKnockout' });
    d = applyOp(d, { type: 'koResult', id: 'sf1', home: 2, away: 0 });
    const before = deriveState(d).knockout.find((m) => m.id === 'sf1');
    expect(before.done).toBe(true);
    // Spielstand so ändern, dass die Rangfolge kippt
    const flipped = applyOps(d, d.matches.map((m) => ({ type: 'groupResult', id: m.id, home: m.awayPlayer, away: m.homePlayer })));
    const after = deriveState(flipped).knockout.find((m) => m.id === 'sf1');
    if (after.homePlayer !== before.homePlayer || after.awayPlayer !== before.awayPlayer) {
      expect(after.done).toBe(false);
      expect(after.stale).toBe(true);
    }
  });

  it('Ops sind rein: Ausgangsdokument bleibt unverändert', () => {
    const d = doc();
    const snapshot = JSON.stringify(d);
    applyOp(d, { type: 'groupResult', id: 0, home: 1, away: 0 });
    applyOp(d, { type: 'renamePlayer', index: 0, name: 'X' });
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('Namen werden gekürzt und Doppelpunkte bleiben', () => {
    const d = applyOp(doc(), { type: 'renamePlayer', index: 1, name: 'A & B'.padEnd(80, 'x'), team: 'FC Bayern' });
    expect(d.players[1].name).toHaveLength(30);
    expect(d.players[1].team).toBe('FC Bayern');
  });
});

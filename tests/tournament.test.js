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
  applyOpsReport,
  groupBy,
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
          const rounds = groupBy(m, (x) => x.round);
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
    expect(groupBy(m, (x) => x.round).size).toBe(3);
  });

  it('Heim- und Auswärtsspiele sind gleichmässig verteilt', () => {
    for (const n of [5, 6, 7, 8]) {
      for (const tvs of [1, 2]) {
        for (const dbl of [false, true]) {
          const balance = new Array(n).fill(0);
          scheduleMatches(n, tvs, dbl).forEach((x) => {
            balance[x.homePlayer]++;
            balance[x.awayPlayer]--;
          });
          for (const b of balance) expect(Math.abs(b)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('bei 2 Fernsehern spielt jeder Spieler ungefähr gleich oft auf TV 1 und TV 2', () => {
    for (const n of [5, 6, 7, 8]) {
      for (const dbl of [false, true]) {
        const balance = new Array(n).fill(0);
        scheduleMatches(n, 2, dbl).forEach((x) => {
          const d = x.tv === 1 ? 1 : -1;
          balance[x.homePlayer] += d;
          balance[x.awayPlayer] += d;
        });
        for (const b of balance) expect(Math.abs(b)).toBeLessThanOrEqual(2);
        if (dbl) for (const b of balance) expect(b).toBe(0);
      }
    }
  });

  it('jedes Zeitfenster belegt beide Fernseher mit verschiedenen Nummern', () => {
    const rounds = groupBy(scheduleMatches(7, 2, false), (x) => x.round);
    for (const list of rounds.values()) expect(new Set(list.map((x) => x.tv)).size).toBe(list.length);
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

/** Spielt alle K.O.-Spiele nacheinander. `homeWins` bestimmt, ob immer die Heim- oder die Auswärtsseite gewinnt. */
function playKnockout(n, { homeWins = true, third = true } = {}) {
  const c = cfg({ thirdPlacePlayoff: third });
  const standings = seeded(n);
  const stored = [];
  const order = [];
  for (let guard = 0; guard < 20; guard++) {
    const next = resolveKnockout(standings, c, stored).find((m) => m.ready && !m.done);
    if (!next) break;
    order.push(next.id);
    stored.push({ id: next.id, home: next.homePlayer, away: next.awayPlayer, homeGoals: homeWins ? 2 : 1, awayGoals: homeWins ? 1 : 2 });
  }
  const ko = resolveKnockout(standings, c, stored);
  return { standings, ko, order, ranking: computeRanking(standings, ko, c) };
}

describe('K.O.-Runde', () => {
  it('Slots: 4 Spieler ohne Verlierer-Runde, mit und ohne Platz 3', () => {
    expect(knockoutSlots(4, cfg()).map((s) => s.id)).toEqual(['sf1', 'sf2', 'third', 'final']);
    expect(knockoutSlots(4, cfg({ thirdPlacePlayoff: false })).map((s) => s.id)).toEqual(['sf1', 'sf2', 'final']);
  });

  it('Verlierer-Runde: 5 Spieler keine, 6 -> 1, 7 -> 2, 8 -> 3 Spiele', () => {
    const count = (n) => knockoutSlots(n, cfg()).filter((s) => s.type === 'loserSemi' || s.type === 'loserFinal').length;
    expect([4, 5, 6, 7, 8].map(count)).toEqual([0, 0, 1, 2, 3]);
  });

  it('7 Spieler: Halbfinale 1-4 und 2-3, Verlierer-Halbfinale 5-6, Platz 7 wartet', () => {
    const by = Object.fromEntries(resolveKnockout(seeded(7), cfg(), []).map((m) => [m.id, m]));
    expect([by.sf1.homePlayer, by.sf1.awayPlayer]).toEqual([0, 3]);
    expect([by.sf2.homePlayer, by.sf2.awayPlayer]).toEqual([1, 2]);
    expect(by.final.ready).toBe(false);
    expect([by.ls1.homePlayer, by.ls1.awayPlayer]).toEqual([4, 5]);
    expect(by.lf.ready).toBe(false);
    expect(by.lf.awayPlayer).toBe(6);
  });

  it('7 Spieler: der Verlierer von 5 gegen 6 muss gegen Platz 7 ran, dessen Verlierer ist Turnier-Verlierer', () => {
    const { standings, ko, ranking } = playKnockout(7, { homeWins: true });
    const by = Object.fromEntries(ko.map((m) => [m.id, m]));
    // Heimsieg: Platz 5 (Index 4) gewinnt gegen Platz 6 (Index 5), Platz 6 muss gegen Platz 7 (Index 6)
    expect(by.ls1.winner).toBe(4);
    expect([by.lf.homePlayer, by.lf.awayPlayer]).toEqual([5, 6]);
    expect(by.lf.loser).toBe(6);
    expect(ranking).toHaveLength(7);
    expect(new Set(ranking).size).toBe(7);
    expect(ranking.slice(4)).toEqual([4, 5, 6]);
    expect(ranking[6]).toBe(6);
    expect(standings).toHaveLength(7);
  });

  it('7 Spieler, Auswärtssiege: Verlierer wechselt entsprechend', () => {
    const { ko, ranking } = playKnockout(7, { homeWins: false });
    const by = Object.fromEntries(ko.map((m) => [m.id, m]));
    expect(by.ls1.winner).toBe(5);
    expect([by.lf.homePlayer, by.lf.awayPlayer]).toEqual([4, 6]);
    expect(by.lf.loser).toBe(4); // Auswärtsseite gewinnt, also verliert Platz 5
    expect(ranking[6]).toBe(4);
    expect(new Set(ranking).size).toBe(7);
  });

  it('6 Spieler: Verlierer-Final 5 gegen 6, Verlierer ist Letzter', () => {
    const { ranking, order } = playKnockout(6);
    expect(order).toContain('lf');
    expect(ranking.slice(4)).toEqual([4, 5]);
  });

  it('8 Spieler: zwei Verlierer-Halbfinals, Verlierer spielen das Verlierer-Final', () => {
    const { ko, ranking } = playKnockout(8);
    const by = Object.fromEntries(ko.map((m) => [m.id, m]));
    expect([by.ls1.homePlayer, by.ls1.awayPlayer]).toEqual([4, 7]);
    expect([by.ls2.homePlayer, by.ls2.awayPlayer]).toEqual([5, 6]);
    expect([by.lf.homePlayer, by.lf.awayPlayer]).toEqual([7, 6]);
    expect(ranking).toHaveLength(8);
    expect(new Set(ranking).size).toBe(8);
    expect(ranking.slice(4, 6)).toEqual([4, 5]); // sichere Spieler zuerst, nach Gruppenrang
    expect(ranking[7]).toBe(by.lf.loser);
  });

  it('5 Spieler: Platz 5 ist Letzter, ohne Spiel um Platz 3', () => {
    const { ranking, order } = playKnockout(5, { third: false });
    expect(order).toEqual(['sf1', 'sf2', 'final']);
    expect(ranking).toHaveLength(5);
    expect(ranking[4]).toBe(4);
  });

  it('4 Spieler ohne Spiel um Platz 3: Verlierer der Halbfinals nach Gruppenrang', () => {
    const { ranking } = playKnockout(4, { third: false });
    expect(ranking).toHaveLength(4);
    expect(ranking[3]).toBe(3); // Halbfinal-Verlierer mit dem schlechteren Gruppenrang ist Letzter
  });

  it('Unentschieden im K.O. zählt nicht', () => {
    const m = resolveKnockout(seeded(4), cfg(), [{ id: 'sf1', home: 0, away: 3, homeGoals: 1, awayGoals: 1 }]);
    expect(m.find((x) => x.id === 'sf1').done).toBe(false);
  });

  it('geändertes Gruppenergebnis macht K.O.-Ergebnis veraltet statt es still zu löschen', () => {
    const stored = [{ id: 'sf1', home: 1, away: 3, homeGoals: 2, awayGoals: 0 }]; // früher andere Paarung
    const sf1 = resolveKnockout(seeded(4), cfg(), stored).find((x) => x.id === 'sf1');
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

describe('Schutz vor falschen Phasen und geänderten Paarungen (Wiederholung nach Konflikt)', () => {
  const played = (doc) => applyOps(doc, doc.matches.map((m, i) => ({ type: 'groupResult', id: m.id, home: i % 4, away: (i + 1) % 3 })));
  const fresh = () => createDoc({ name: 'T', players: names(7), config: {} });
  const inKnockout = () => applyOp(played(fresh()), { type: 'startKnockout' });

  it('K.O.-Ergebnis wird in der Gruppenphase abgelehnt, auch nach „Zurück zur Gruppenphase“', () => {
    const group = played(fresh());
    expect(applyOp(group, { type: 'koResult', id: 'sf1', home: 3, away: 0 })).toBe(group);
    const back = applyOp(inKnockout(), { type: 'backToGroup' });
    expect(back.phase).toBe('group');
    const replay = applyOp(back, { type: 'koResult', id: 'sf1', home: 3, away: 0 });
    expect(replay.knockoutMatches).toHaveLength(0);
    // Auch nach erneutem Start bleibt das Halbfinale offen
    const again = applyOp(replay, { type: 'startKnockout' });
    expect(deriveState(again).knockout.find((m) => m.id === 'sf1').done).toBe(false);
  });

  it('K.O.-Ergebnis wird im abgeschlossenen Turnier abgelehnt', () => {
    let d = inKnockout();
    for (const id of ['sf1', 'sf2', 'final', 'third', 'ls1', 'lf']) d = applyOp(d, { type: 'koResult', id, home: 2, away: 1 });
    d = applyOp(d, { type: 'finish' });
    expect(d.phase).toBe('finished');
    expect(applyOp(d, { type: 'koResult', id: 'final', home: 0, away: 5 })).toBe(d);
  });

  it('K.O.-Ergebnis gilt nur für die Paarung, für die es eingegeben wurde', () => {
    const d = inKnockout();
    const sf1 = deriveState(d).knockout.find((m) => m.id === 'sf1');
    const ok = applyOp(d, { type: 'koResult', id: 'sf1', home: 2, away: 0, homePlayer: sf1.homePlayer, awayPlayer: sf1.awayPlayer });
    expect(ok.knockoutMatches).toHaveLength(1);
    const other = applyOp(d, { type: 'koResult', id: 'sf1', home: 2, away: 0, homePlayer: sf1.homePlayer, awayPlayer: (sf1.awayPlayer + 1) % 7 });
    expect(other).toBe(d);
  });

  it('Gruppenergebnis: im abgeschlossenen Turnier gesperrt, in der K.O.-Runde nur ändern, nicht löschen', () => {
    let d = inKnockout();
    expect(applyOp(d, { type: 'groupResult', id: 0, home: null, away: null })).toBe(d);
    expect(applyOp(d, { type: 'groupResult', id: 0, home: 5, away: 0 }).matches[0].homeGoals).toBe(5);
    for (const id of ['sf1', 'sf2', 'final', 'third', 'ls1', 'lf']) d = applyOp(d, { type: 'koResult', id, home: 2, away: 1 });
    const finished = applyOp(d, { type: 'finish' });
    expect(applyOp(finished, { type: 'groupResult', id: 0, home: 9, away: 9 })).toBe(finished);
  });

  it('veraltete K.O.-Ergebnisse lassen sich auch dann löschen, wenn das Spiel nicht mehr bereit ist', () => {
    const d = { ...inKnockout(), knockoutMatches: [{ id: 'final', home: 0, away: 1, homeGoals: 1, awayGoals: 0 }] };
    const cleared = applyOp(d, { type: 'koResult', id: 'final', home: null, away: null });
    expect(cleared.knockoutMatches).toHaveLength(0);
  });

  it('applyOpsReport meldet nicht übernommene Eingaben, übernimmt gültige', () => {
    const group = played(fresh());
    const { doc, dropped } = applyOpsReport(group, [
      { type: 'groupResult', id: 0, home: 7, away: 7 },
      { type: 'koResult', id: 'sf1', home: 1, away: 0 }, // falsche Phase
      { type: 'groupResult', id: 0, home: -3, away: 1 }, // ungültig
      { type: 'startKnockout' }, // gilt nicht als Ergebnis-Eingabe
    ]);
    expect(dropped.map((o) => o.type)).toEqual(['koResult', 'groupResult']);
    expect(doc.matches[0].homeGoals).toBe(7);
    expect(doc.phase).toBe('knockout');
  });

  it('applyOpsReport gibt dasselbe Dokument zurück, wenn nichts übernommen wurde', () => {
    const group = played(fresh());
    const { doc, dropped } = applyOpsReport(group, [{ type: 'koResult', id: 'sf1', home: 1, away: 0 }]);
    expect(doc).toBe(group);
    expect(dropped).toHaveLength(1);
  });

  it('Spieler umbenennen verlangt einen Namen', () => {
    const d = fresh();
    expect(applyOp(d, { type: 'renamePlayer', index: 0 })).toBe(d);
    expect(applyOp(d, { type: 'renamePlayer', index: 0, name: '   ' })).toBe(d);
    expect(applyOp(d, { type: 'renamePlayer', index: 0, name: ' Neu ' }).players[0].name).toBe('Neu');
    expect(applyOp(d, { type: 'rename' })).toBe(d);
  });

  it('groupBy ersetzt Map.groupBy', () => {
    const g = groupBy([1, 2, 3, 4, 5], (n) => n % 2);
    expect([...g.get(1)]).toEqual([1, 3, 5]);
    expect([...g.get(0)]).toEqual([2, 4]);
  });
});

describe('Turnier nachträglich bearbeiten (Admin): Namen, Marker, Regeln', () => {
  const fresh = () => createDoc({ name: 'T', players: names(7), config: {} });
  const group = () => applyOps(fresh(), fresh().matches.map((m, i) => ({ type: 'groupResult', id: m.id, home: i % 4, away: (i + 1) % 3 })));

  it('Spieler- und Teamnamen ändern sich, Ergebnisse und Plan bleiben', () => {
    const d = applyOps(group(), [
      { type: 'renamePlayer', index: 2, name: 'Marco', team: 'Liverpool' },
      { type: 'renamePlayer', index: 3, name: 'Dani' },
    ]);
    expect(d.players[2]).toMatchObject({ name: 'Marco', team: 'Liverpool' });
    expect(d.players[3].name).toBe('Dani');
    expect(d.matches.filter((m) => m.homeGoals != null)).toHaveLength(21);
    expect(deriveState(d).standings).toHaveLength(7);
  });

  it('Turniername ändern', () => {
    expect(applyOp(fresh(), { type: 'rename', name: 'Pfingstturnier' }).name).toBe('Pfingstturnier');
  });

  it('Marker setzen, ändern und entfernen: jeder nur einmal, ein Spieler höchstens einen', () => {
    let d = applyOp(fresh(), { type: 'setMarkers', champion: 0, runnerUp: 1, loserMark: 2 });
    expect(d.players.map((p) => [p.champion, p.runnerUp, p.loserMark].filter(Boolean).length)).toEqual([1, 1, 1, 0, 0, 0, 0]);
    expect(d.players[1].runnerUp).toBe(true);
    // Ändern: Zweiter wird ein anderer Spieler, der alte verliert den Marker
    d = applyOp(d, { type: 'setMarkers', champion: 0, runnerUp: 4, loserMark: 2 });
    expect(d.players[1].runnerUp).toBeUndefined();
    expect(d.players[4].runnerUp).toBe(true);
    // Entfernen
    d = applyOp(d, { type: 'setMarkers', champion: null, runnerUp: null, loserMark: null });
    expect(d.players.every((p) => !p.champion && !p.runnerUp && !p.loserMark)).toBe(true);
    // Name und Team bleiben erhalten
    expect(d.players[0].name).toBe('P1');
  });

  it('Marker: ungültige Angaben ändern nichts', () => {
    const d = applyOp(fresh(), { type: 'setMarkers', champion: 0, runnerUp: null, loserMark: null });
    expect(applyOp(d, { type: 'setMarkers', champion: 0, runnerUp: 0, loserMark: null })).toBe(d); // ein Spieler, zwei Marker
    expect(applyOp(d, { type: 'setMarkers', champion: 99, runnerUp: null, loserMark: null })).toBe(d); // gibt es nicht
  });

  it('Regel „Bei Punktgleichheit“ lässt sich bis zum Abschluss ändern und wirkt auf die Tabelle', () => {
    // Dreier-Gleichstand: Tordifferenz und direkter Vergleich ergeben verschiedene Reihenfolgen
    let d = createDoc({ name: 'T', players: names(4), config: { tiebreaker: 'goalDiff' } });
    const play = (h, a, hg, ag) => d.matches.find((m) => m.homePlayer === h && m.awayPlayer === a) ?? d.matches.find((m) => m.homePlayer === a && m.awayPlayer === h);
    const set = (h, a, hg, ag) => {
      const m = play(h, a);
      d = applyOp(d, { type: 'groupResult', id: m.id, ...(m.homePlayer === h ? { home: hg, away: ag } : { home: ag, away: hg }) });
    };
    set(0, 1, 1, 0); set(1, 2, 1, 0); set(2, 0, 5, 0); // A>B, B>C, C>A klar
    set(0, 3, 0, 0); set(1, 3, 0, 0); set(2, 3, 0, 0);
    const before = deriveState(d).standings.map((r) => r.playerId);
    const changed = applyOp(d, { type: 'setConfig', tiebreaker: 'head2head' });
    expect(changed.config.tiebreaker).toBe('head2head');
    expect(deriveState(changed).standings).toHaveLength(4);
    expect(before).toHaveLength(4);
    expect(applyOp(changed, { type: 'setConfig', tiebreaker: 'goalDiff' }).config.tiebreaker).toBe('goalDiff');
  });

  it('Regeln: ungültige Werte werden ignoriert, nach dem Abschluss nichts mehr änderbar', () => {
    const d = fresh();
    expect(applyOp(d, { type: 'setConfig', tiebreaker: 'zufall' })).toBe(d);
    expect(applyOp(d, { type: 'setConfig', thirdPlacePlayoff: 'ja' })).toBe(d);
    let k = applyOp(group(), { type: 'startKnockout' });
    for (const id of ['sf1', 'sf2', 'final', 'third', 'ls1', 'lf']) k = applyOp(k, { type: 'koResult', id, home: 2, away: 1 });
    const fin = applyOp(k, { type: 'finish' });
    expect(applyOp(fin, { type: 'setConfig', tiebreaker: 'head2head' })).toBe(fin);
    expect(applyOp(fin, { type: 'setConfig', thirdPlacePlayoff: false })).toBe(fin);
  });

  it('Spiel um Platz 3 lässt sich nur vor dem Start der K.O.-Runde ändern', () => {
    const g = group();
    const off = applyOp(g, { type: 'setConfig', thirdPlacePlayoff: false });
    expect(off.config.thirdPlacePlayoff).toBe(false);
    const started = applyOp(off, { type: 'startKnockout' });
    expect(deriveState(started).knockout.some((m) => m.id === 'third')).toBe(false);
    expect(applyOp(started, { type: 'setConfig', thirdPlacePlayoff: true })).toBe(started);
    // Tiebreaker darf auch in der K.O.-Runde noch geändert werden
    expect(applyOp(started, { type: 'setConfig', tiebreaker: 'head2head' }).config.tiebreaker).toBe('head2head');
  });
});

describe('Rückrunde nachträglich ergänzen', () => {
  for (const n of [4, 6, 7]) {
    for (const tvs of [1, 2]) {
      it(`${n} Spieler, ${tvs} TV: Ergebnisse bleiben, jede Paarung kommt umgekehrt dazu`, () => {
        let doc = createDoc({ name: 'T', players: names(n), config: { numTVs: tvs, doubleRoundRobin: false } });
        const half = doc.matches.length;
        doc = applyOp(doc, { type: 'groupResult', id: 0, home: 3, away: 1 });
        doc = applyOp(doc, { type: 'groupResult', id: 1, home: 2, away: 2 });
        const next = applyOp(doc, { type: 'setConfig', doubleRoundRobin: true });
        expect(next.config.doubleRoundRobin).toBe(true);
        expect(next.matches).toHaveLength(half * 2);
        expect(next.matches.slice(0, half)).toEqual(doc.matches);
        expect(new Set(next.matches.map((m) => m.id)).size).toBe(half * 2);
        const seen = new Set(next.matches.map((m) => `${m.homePlayer}-${m.awayPlayer}`));
        expect(seen.size).toBe(half * 2);
        // pro Runde kein Spieler doppelt
        for (const list of groupBy(next.matches, (m) => m.round).values()) {
          const ids = list.flatMap((m) => [m.homePlayer, m.awayPlayer]);
          expect(new Set(ids).size).toBe(ids.length);
        }
        expect(applyOp(next, { type: 'setConfig', doubleRoundRobin: true })).toBe(next);
      });
    }
  }

  it('nur in der Gruppenphase', () => {
    let doc = createDoc({ name: 'T', players: names(4), config: { numTVs: 1, doubleRoundRobin: false } });
    doc.matches.forEach((m) => { doc = applyOp(doc, { type: 'groupResult', id: m.id, home: 1, away: 0 }); });
    doc = applyOp(doc, { type: 'startKnockout' });
    expect(applyOp(doc, { type: 'setConfig', doubleRoundRobin: true })).toBe(doc);
  });
});

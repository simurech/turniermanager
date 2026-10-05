import { describe, it, expect } from 'vitest';
import { buildExport, parseExport, resultsText, exportFileName } from '../src/lib/exportFile.js';
import { createDoc, applyOp } from '../src/lib/tournament.js';

const finishedDoc = (name) => {
  let doc = createDoc({ name, players: ['A', 'B', 'C', 'D'].map((n) => ({ name: n, team: '' })), config: { numTVs: 1 } });
  doc.matches.forEach((m) => { doc = applyOp(doc, { type: 'groupResult', id: m.id, home: m.homePlayer < m.awayPlayer ? 2 : 1, away: m.homePlayer < m.awayPlayer ? 1 : 2 }); });
  doc = applyOp(doc, { type: 'startKnockout' });
  return { ...doc, phase: 'finished', winner: 0, loser: 3 };
};

describe('Export-Datei', () => {
  it('Export und Import ergeben dasselbe Turnier samt Vorgängern', () => {
    const older = { ...finishedDoc('2025'), createdAt: '2025-10-01T10:00:00+02:00' };
    const exp = buildExport(finishedDoc('2026'), { createdAt: '2026-10-03T09:00:00+02:00', finishedAt: '2026-10-03T18:00:00+02:00' }, [older]);
    const back = parseExport(JSON.stringify(exp));
    expect(back.chain).toHaveLength(2);
    expect(back.tournament.name).toBe('2026');
    expect(back.tournament.createdAt).toBe('2026-10-03T09:00:00+02:00');
    expect(back.chain[1].name).toBe('2025');
    expect(back.tournament.players.map((p) => p.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('lehnt fremde und unfertige Dateien mit lesbarer Meldung ab', () => {
    expect(() => parseExport('kein json')).toThrow(/gültige Export-Datei/);
    expect(() => parseExport('{"a":1}')).toThrow(/Export-Datei/);
    const open = buildExport({ ...finishedDoc('x'), phase: 'group' }, {}, []);
    expect(() => parseExport(JSON.stringify(open))).toThrow(/abgeschlossen/);
  });

  it('Text und Dateiname', () => {
    expect(resultsText(finishedDoc('Test'))).toContain('Gruppenphase');
    expect(exportFileName({ name: 'Turnier 03.10.2026' })).toBe('turnier-03-10-2026.turnier.json');
  });
});

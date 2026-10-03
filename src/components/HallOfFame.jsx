import { useMemo } from 'react';
import { hallOfFame } from '../lib/stats.js';

/** Ewige Tabelle über alle übergebenen (abgeschlossenen) Turniere. */
export default function HallOfFame({ docs }) {
  const table = useMemo(() => hallOfFame(docs), [docs]);
  if (!table.length) return <p className="empty">Noch keine abgeschlossenen Turniere.</p>;
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
      <table className="hof">
        <thead>
          <tr>
            <th scope="col">Spieler</th>
            <th scope="col" title="Turniersiege">🏆</th>
            <th scope="col" title="Zweite Plätze">🥈</th>
            <th scope="col" title="Letzte Plätze">🍋</th>
            <th scope="col" title="Turniere">Tur.</th>
            <th scope="col" title="Siegquote">Sieg%</th>
            <th scope="col" title="Tordifferenz">TD</th>
          </tr>
        </thead>
        <tbody>
          {table.map((e) => (
            <tr key={e.key}>
              <td>
                <strong>{e.name}</strong>
              </td>
              <td>{e.titles}</td>
              <td>{e.seconds}</td>
              <td>{e.lastPlaces}</td>
              <td>{e.tournaments}</td>
              <td>{e.played ? Math.round(e.winRate * 100) : '–'}</td>
              <td>{e.goalDiff > 0 ? `+${e.goalDiff}` : e.goalDiff}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

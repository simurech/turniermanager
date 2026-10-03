import { useEffect, useMemo, useState } from 'react';
import { playerForm, quote, simulateOutcomes, streakLabel } from '../lib/stats.js';
import { Dots, Marks, Section } from './ui.jsx';
import HallOfFame from './HallOfFame.jsx';

const fmt = (q) => (q == null ? '–' : q.toFixed(1));

function Odds({ doc, history }) {
  const [odds, setOdds] = useState(null);
  const signature = useMemo(
    () => JSON.stringify([doc.matches.map((m) => [m.id, m.homeGoals, m.awayGoals]), doc.phase, doc.knockoutMatches, history.docs.length]),
    [doc.matches, doc.phase, doc.knockoutMatches, history.docs.length],
  );
  useEffect(() => {
    if (history.loading) return undefined;
    const timer = setTimeout(() => setOdds(simulateOutcomes(doc, history.docs, 1500)), 30);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, history.loading]);

  if (!odds) return <p className="empty">Quoten werden berechnet …</p>;
  const rows = [...odds.players].sort((a, b) => b.champion - a.champion);
  return (
    <>
      <table className="odds">
        <thead>
          <tr>
            <th scope="col">Spieler</th>
            <th scope="col" className="q">Titel</th>
            <th scope="col" className="q">Letzter 🍋</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index}>
              <td>{doc.players[r.index].name} <Marks player={doc.players[r.index]} /></td>
              <td className="q">{fmt(quote(r.champion))}</td>
              <td className="q">{fmt(quote(r.last))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        {odds.confidence < 0.5 ? 'Noch wenig Daten: Die Quoten verändern sich mit jedem Spiel. ' : ''}
        {history.docs.length ? `Berechnet aus diesem Turnier und ${history.docs.length} früheren. ` : 'Ohne Vorjahre, nur aus diesem Turnier. '}
        Reine Spielerei, ohne Gewähr 😉
      </p>
    </>
  );
}

export default function StatsTab({ doc, derived, history }) {
  const finishedDocs = useMemo(() => [doc, ...history.docs].filter((d) => d.phase === 'finished'), [doc, history.docs]);
  const order = derived.standings.map((r) => r.playerId);
  return (
    <>
      <Section>Form</Section>
      {order.map((index) => {
        const form = playerForm(doc, index, 5);
        const label = streakLabel(form.streak);
        return (
          <div key={index} className="formrow">
            <span>
              <strong>{doc.players[index].name}</strong> <Marks player={doc.players[index]} />
              {label && <small className="muted"> · {label}</small>}
            </span>
            {form.results.length ? <Dots results={form.results} /> : <small className="muted">noch kein Spiel</small>}
          </div>
        );
      })}

      {doc.phase !== 'finished' && (
        <>
          <Section>Wettquoten</Section>
          <Odds doc={doc} history={history} />
        </>
      )}

      <Section>Ewige Tabelle</Section>
      {history.loading ? <p className="empty">Lädt Vorjahre …</p> : <HallOfFame docs={finishedDocs} />}
      {!history.loading && history.docs.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>Dieses Turnier hat keinen Vorgänger. Mit einem Vorjahr als Basis erscheinen hier alle Jahre und die Quoten werden genauer.</p>}
    </>
  );
}

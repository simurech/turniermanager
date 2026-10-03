import { isPlayed } from '../lib/tournament.js';
import { PHASE_LABEL, nameOf, teamOf } from '../lib/format.js';
import { Marks } from './ui.jsx';

/** Grosse Ansicht für Fernseher oder Beamer: nächstes Spiel, Tabelle und K.O.-Stand. Aktualisiert sich über das Polling. */
export default function TvView({ doc, derived, nextMatch, onExit }) {
  const finished = doc.phase === 'finished';
  const winner = doc.players[doc.winner];
  const loser = doc.players[doc.loser];
  return (
    <main className="app tv no-tabs">
      <div className="topbar">
        <div className="title">
          <span className="logo">{doc.name || 'Turnier'}</span>
          <span className="eyebrow">{PHASE_LABEL[doc.phase].toUpperCase()}</span>
        </div>
        <button className="iconbtn" onClick={onExit} aria-label="TV-Ansicht beenden">✕</button>
      </div>

      {finished && winner && (
        <div className="podium">
          <div className="cup" aria-hidden>🏆</div>
          <span className="eyebrow">TURNIERSIEGER</span>
          <h1>{winner.name}</h1>
          {loser && <p style={{ marginTop: 8 }}>🍋 {loser.name} geht auf die Pressekonferenz</p>}
        </div>
      )}

      {!finished && nextMatch && nextMatch.homePlayer != null && (
        <div className="banner">
          <span className="eyebrow">NÄCHSTES SPIEL{doc.phase === 'group' ? ` · RUNDE ${nextMatch.round} · TV ${nextMatch.tv}` : ` · ${nextMatch.label.toUpperCase()}`}</span>
          <div className="vs">
            <b>{nameOf(doc, nextMatch.homePlayer)}</b>
            <i>VS</i>
            <b>{nameOf(doc, nextMatch.awayPlayer)}</b>
          </div>
        </div>
      )}

      <div className="tbl" role="table" aria-label="Tabelle">
        <div className="th" role="row"><span>#</span><span>SPIELER</span><span>SP</span><span>TD</span><span style={{ textAlign: 'right' }}>PKT</span></div>
        {derived.standings.map((r) => {
          const p = doc.players[r.playerId];
          return (
            <div key={r.playerId} role="row" className={`tr ${p.champion ? 'champ' : ''} ${p.loserMark ? 'lastrow' : ''}`}>
              <span className="rank">{r.rank}</span>
              <span className="who">{p.name} <Marks player={p} /><small>{teamOf(doc, r.playerId) || ' '}</small></span>
              <span>{r.played}</span>
              <span>{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</span>
              <span className="pts">{r.points}</span>
            </div>
          );
        })}
      </div>

      {derived.knockout.length > 0 && (
        <div className="tv-ko">
          {derived.knockout.map((m) => (
            <div key={m.id} className="card">
              <span className="eyebrow">{m.label.toUpperCase()}</span>
              <div>
                {m.homePlayer != null ? nameOf(doc, m.homePlayer) : '?'}{' '}
                <strong>{isPlayed(m) ? `${m.homeGoals} : ${m.awayGoals}` : 'vs'}</strong>{' '}
                {m.awayPlayer != null ? nameOf(doc, m.awayPlayer) : '?'}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

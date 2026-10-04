import { useMemo, useState } from 'react';
import { Dialog, Segmented, Switch } from './ui.jsx';

/**
 * Turnier nachträglich bearbeiten (nur Admin): Turnier- und Spielernamen, Teams sowie Regeln.
 * Gibt die Änderungen als Operationen zurück, die wie Ergebnisse gespeichert werden.
 */
export default function EditTournament({ doc, onSave, onClose }) {
  const [name, setName] = useState(doc.name || '');
  const [players, setPlayers] = useState(() => doc.players.map((p) => ({ name: p.name, team: p.team || '' })));
  const [tiebreaker, setTiebreaker] = useState(doc.config.tiebreaker || 'goalDiff');
  const [third, setThird] = useState(Boolean(doc.config.thirdPlacePlayoff));
  const initialMarkers = () => {
    const find = (field) => {
      const i = doc.players.findIndex((p) => p[field]);
      return i >= 0 ? i : null;
    };
    return { champion: find('champion'), runnerUp: find('runnerUp'), loserMark: find('loserMark') };
  };
  const [markers, setMarkers] = useState(initialMarkers);
  // Ein Marker gehört einem Spieler, ein Spieler trägt höchstens einen
  const toggleMarker = (field, index) =>
    setMarkers((m) => {
      const next = { champion: m.champion, runnerUp: m.runnerUp, loserMark: m.loserMark };
      for (const f of Object.keys(next)) if (next[f] === index) next[f] = null;
      next[field] = m[field] === index ? null : index;
      return next;
    });

  const finished = doc.phase === 'finished';
  const thirdEditable = doc.phase === 'group';
  const [double, setDouble] = useState(Boolean(doc.config.doubleRoundRobin));
  const doubleEditable = doc.phase === 'group' && !doc.config.doubleRoundRobin;

  const problems = useMemo(() => {
    const list = [];
    if (players.some((p) => !p.name.trim())) list.push('Jeder Spieler braucht einen Namen.');
    const names = players.map((p) => p.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(names).size !== names.length) list.push('Die Namen müssen verschieden sein.');
    return list;
  }, [players]);

  const update = (index, patch) => setPlayers((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  function save() {
    const ops = [];
    if (name.trim() !== (doc.name || '')) ops.push({ type: 'rename', name: name.trim() });
    players.forEach((p, index) => {
      const old = doc.players[index];
      if (p.name.trim() !== old.name || p.team.trim() !== (old.team || '')) {
        ops.push({ type: 'renamePlayer', index, name: p.name.trim(), team: p.team.trim() });
      }
    });
    const before = { champion: doc.players.findIndex((p) => p.champion), runnerUp: doc.players.findIndex((p) => p.runnerUp), loserMark: doc.players.findIndex((p) => p.loserMark) };
    const same = Object.keys(markers).every((f) => (markers[f] ?? -1) === before[f]);
    if (!same) ops.push({ type: 'setMarkers', champion: markers.champion, runnerUp: markers.runnerUp, loserMark: markers.loserMark });
    const config = {};
    if (!finished && tiebreaker !== doc.config.tiebreaker) config.tiebreaker = tiebreaker;
    if (thirdEditable && third !== Boolean(doc.config.thirdPlacePlayoff)) config.thirdPlacePlayoff = third;
    if (doubleEditable && double) config.doubleRoundRobin = true;
    if (Object.keys(config).length) ops.push({ type: 'setConfig', ...config });
    onSave(ops);
  }

  return (
    <Dialog sheet title="Turnier bearbeiten" onClose={onClose}>
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="edit-name">Turniername</label>
        <input id="edit-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </div>

      <span className="label">Spieler, Teams und Marker</span>
      <p className="muted small" style={{ margin: '-2px 0 8px' }}>👑 amtierender Meister · 🥈 Zweiter · 🍋 Verlierer des letzten Turniers</p>
      {players.map((p, i) => (
        <div key={i} className="field">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="input" aria-label={`Name Spieler ${i + 1}`} value={p.name} maxLength={30} onChange={(e) => update(i, { name: e.target.value })} />
            <input className="input" aria-label={`Team Spieler ${i + 1}`} placeholder="Team" value={p.team} maxLength={30} onChange={(e) => update(i, { team: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" className="mark" aria-pressed={markers.champion === i} aria-label={`${p.name || `Spieler ${i + 1}`} ist amtierender Meister`} title="Amtierender Meister" onClick={() => toggleMarker('champion', i)}>👑</button>
            <button type="button" className="mark" aria-pressed={markers.runnerUp === i} aria-label={`${p.name || `Spieler ${i + 1}`} ist amtierender Zweiter`} title="Amtierender Zweiter" onClick={() => toggleMarker('runnerUp', i)}>🥈</button>
            <button type="button" className="mark lose" aria-pressed={markers.loserMark === i} aria-label={`${p.name || `Spieler ${i + 1}`} ist amtierender Verlierer`} title="Amtierender Verlierer" onClick={() => toggleMarker('loserMark', i)}>🍋</button>
          </div>
        </div>
      ))}

      <span className="label" style={{ marginTop: 8, display: 'block' }}>Regeln</span>
      <div className="field">
        <Segmented
          label="Bei Punktgleichheit"
          value={tiebreaker}
          onChange={(v) => !finished && setTiebreaker(v)}
          options={[{ value: 'goalDiff', label: 'Tordifferenz' }, { value: 'head2head', label: 'Direkter Vergleich' }]}
        />
        {finished && <p className="muted small" style={{ marginTop: 6 }}>Nach dem Abschluss lassen sich die Regeln nicht mehr ändern.</p>}
        {!finished && doc.phase === 'knockout' && tiebreaker !== doc.config.tiebreaker && (
          <p className="notice" style={{ marginTop: 8 }}>Die K.O.-Runde läuft schon. Ändert sich dadurch die Tabelle, müssen betroffene K.O.-Ergebnisse neu eingetragen werden.</p>
        )}
      </div>
      <div className="field">
        <Switch checked={third} onChange={(v) => thirdEditable && setThird(v)}>Spiel um Platz 3</Switch>
        {!thirdEditable && <p className="muted small">Nur vor dem Start der K.O.-Runde änderbar.</p>}
      </div>

      <div className="field">
        <Switch checked={double} onChange={(v) => doubleEditable && setDouble(v)}>Hin- und Rückrunde</Switch>
        {doubleEditable
          ? <p className="muted small">Hängt die Rückspiele an den Spielplan an. Bisherige Ergebnisse bleiben erhalten. Danach nicht mehr rückgängig zu machen.</p>
          : <p className="muted small">{doc.config.doubleRoundRobin ? 'Die Rückrunde ist bereits im Spielplan.' : 'Nur in der Gruppenphase änderbar.'}</p>}
      </div>

      {problems.length > 0 && <div className="error" role="alert">{problems.map((p) => <div key={p}>{p}</div>)}</div>}
      <div className="btn-row">
        <button type="button" className="btn alt" onClick={onClose}>Abbrechen</button>
        <button type="button" className="btn" disabled={problems.length > 0} onClick={save}>Speichern</button>
      </div>
    </Dialog>
  );
}

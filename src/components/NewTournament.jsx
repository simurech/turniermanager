import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api.js';
import { setPin, rememberJustCreated } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { DEFAULT_CONFIG, createDoc } from '../lib/tournament.js';
import { dateOf, yearOf } from '../lib/format.js';
import { useApp } from '../context.jsx';
import { Section, Segmented, Switch } from './ui.jsx';

const MAX_ROWS = 10;
const defaultName = () => `Turnier ${dateOf(new Date().toISOString())}`;
let keyCounter = 0;
const blankRow = (over = {}) => ({ key: ++keyCounter, name: '', team: '', selected: true, champion: false, loserMark: false, ...over });

export default function NewTournament() {
  const { admin, toast } = useApp();
  const [name, setName] = useState(defaultName);
  const [finished, setFinished] = useState([]);
  const [previousId, setPreviousId] = useState('');
  const [previousPin, setPreviousPin] = useState('');
  const [rows, setRows] = useState(() => Array.from({ length: 7 }, () => blankRow()));
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [listState, setListState] = useState('loading'); // loading | ok | error
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    setListState('loading');
    api
      .listTournaments()
      .then((r) => {
        setFinished(r.tournaments.filter((t) => t.phase === 'finished'));
        setListState('ok');
      })
      .catch(() => setListState('error'));
  }, [admin, reloadKey]);

  // Vorgänger gewählt: Spieler, Marker und Einstellungen als Vorschlag übernehmen
  useEffect(() => {
    if (!previousId) return undefined;
    let alive = true;
    api
      .loadTournament(previousId)
      .then((prev) => {
        if (!alive) return;
        setRows(prev.players.map((p, i) => blankRow({ name: p.name, champion: i === prev.winner, loserMark: i === prev.loser })));
        setConfig((c) => ({ ...c, numTVs: prev.config.numTVs ?? c.numTVs, doubleRoundRobin: Boolean(prev.config.doubleRoundRobin), tiebreaker: prev.config.tiebreaker ?? c.tiebreaker, thirdPlacePlayoff: prev.config.thirdPlacePlayoff ?? c.thirdPlacePlayoff }));
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [previousId]);

  const selected = rows.filter((r) => r.selected);
  const problems = useMemo(() => {
    const list = [];
    if (selected.length < 4) list.push('Mindestens 4 Spieler auswählen.');
    if (selected.length > 8) list.push('Höchstens 8 Spieler auswählen.');
    if (selected.some((r) => !r.name.trim())) list.push('Alle ausgewählten Spieler brauchen einen Namen.');
    const names = selected.map((r) => r.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(names).size !== names.length) list.push('Namen müssen verschieden sein.');
    if (previousId && !admin && !/^\d{4}$/.test(previousPin)) list.push('PIN des Vorgängers eingeben (4 Ziffern).');
    return list;
  }, [selected, previousId, previousPin, admin]);

  const update = (key, patch) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setMark = (key, field) =>
    setRows((list) => list.map((r) => ({ ...r, [field]: r.key === key ? !r[field] : false })));

  async function submit(e) {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError('');
    try {
      const players = selected.map((r) => ({
        name: r.name.trim(),
        team: r.team.trim(),
        ...(r.champion ? { champion: true } : {}),
        ...(r.loserMark ? { loserMark: true } : {}),
      }));
      const doc = createDoc({ name: name.trim() || defaultName(), players, config });
      const res = await api.createTournament({ data: doc, previousId, previousPin });
      setPin(res.id, res.pin);
      rememberJustCreated(res.id, res.pin);
      navigate(`/t/${res.id}`);
    } catch (err) {
      setError(err.message);
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app no-tabs">
      <div className="topbar">
        <button className="iconbtn" onClick={() => navigate('/')} aria-label="Zurück">←</button>
        <div className="title"><span className="logo">Neues Turnier</span></div>
      </div>

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="tname">Name</label>
          <input id="tname" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>

        {listState === 'error' && (
          <p className="error" role="alert">
            Die früheren Turniere konnten nicht geladen werden. Ohne diese Liste kann kein Vorjahr als Basis gewählt werden.{' '}
            <button type="button" className="link" onClick={() => setReloadKey((n) => n + 1)}>Erneut laden</button>
          </p>
        )}
        {finished.length > 0 && (
          <div className="field">
            <label htmlFor="prev">Vorjahr als Basis (optional)</label>
            <select id="prev" className="input" value={previousId} onChange={(e) => { setPreviousId(e.target.value); setError(''); }}>
              <option value="">Kein Vorgänger – komplett neu</option>
              {finished.map((t) => (
                <option key={t.id} value={t.id}>{t.name || t.id} ({yearOf(t.createdAt)}) · Sieger {t.winnerName || '–'}</option>
              ))}
            </select>
            <p className="muted small" style={{ marginTop: 6 }}>Spieler und Einstellungen werden vorgeschlagen und lassen sich ändern. Das Vorjahr fliesst nur in Statistik und Quoten ein. Alle starten bei 0.</p>
          </div>
        )}
        {previousId && !admin && (
          <div className="field">
            <label htmlFor="ppin">PIN des Vorgängers</label>
            <input id="ppin" className="input pin-input" inputMode="numeric" maxLength={4} value={previousPin} onChange={(e) => setPreviousPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="····" />
          </div>
        )}

        <Section>Spieler ({selected.length})</Section>
        <p className="muted small" style={{ margin: '-4px 4px 12px 0' }}>✓ = spielt mit · 👑 amtierender Meister · 🍋 amtierender Verlierer (optional, wird aus dem Vorjahr vorgeschlagen)</p>
        {rows.map((r, i) => (
          <div key={r.key} className={`player-row ${r.selected ? '' : 'off'}`}>
            <button type="button" className="check" aria-pressed={r.selected} aria-label={`Spieler ${i + 1} dabei`} onClick={() => update(r.key, { selected: !r.selected })}>
              {r.selected ? '✓' : ''}
            </button>
            <div className="fields">
              <div className="namerow">
                <input className="input" placeholder={`Spieler ${i + 1}`} aria-label={`Name Spieler ${i + 1}`} value={r.name} maxLength={30} onChange={(e) => update(r.key, { name: e.target.value })} />
                <button type="button" className="mark" aria-pressed={r.champion} aria-label={`Spieler ${i + 1} ist amtierender Meister`} title="Amtierender Meister" onClick={() => setMark(r.key, 'champion')}>👑</button>
                <button type="button" className="mark lose" aria-pressed={r.loserMark} aria-label={`Spieler ${i + 1} ist amtierender Verlierer`} title="Amtierender Verlierer" onClick={() => setMark(r.key, 'loserMark')}>🍋</button>
              </div>
              <input className="input" placeholder="Team (optional)" aria-label={`Team Spieler ${i + 1}`} value={r.team} maxLength={30} onChange={(e) => update(r.key, { team: e.target.value })} />
            </div>
          </div>
        ))}
        {rows.length < MAX_ROWS && (
          <button type="button" className="btn alt" style={{ width: 'calc(100% - 4px)' }} onClick={() => setRows((l) => [...l, blankRow()])}>+ Spieler hinzufügen</button>
        )}

        <Section>Einstellungen</Section>
        <div className="field">
          <span className="label">Fernseher / Konsolen</span>
          <Segmented label="Anzahl Fernseher" value={config.numTVs} onChange={(v) => setConfig({ ...config, numTVs: v })} options={[{ value: 1, label: '1 TV' }, { value: 2, label: '2 TV' }]} />
        </div>
        <div className="field">
          <span className="label">Bei Punktgleichheit</span>
          <Segmented label="Gleichstand-Regel" value={config.tiebreaker} onChange={(v) => setConfig({ ...config, tiebreaker: v })} options={[{ value: 'goalDiff', label: 'Tordifferenz' }, { value: 'head2head', label: 'Direkter Vergleich' }]} />
        </div>
        <div className="field">
          <Switch checked={config.doubleRoundRobin} onChange={(v) => setConfig({ ...config, doubleRoundRobin: v })}>Hin- und Rückrunde</Switch>
          <Switch checked={config.thirdPlacePlayoff} onChange={(v) => setConfig({ ...config, thirdPlacePlayoff: v })}>Spiel um Platz 3</Switch>
        </div>

        {(problems.length > 0 || error) && (
          <div className="error" role="alert">
            {[...problems, error].filter(Boolean).map((p) => <div key={p}>{p}</div>)}
          </div>
        )}
        <p className="notice">Nach dem Start bekommt das Turnier einen 4-stelligen PIN. Nur wer ihn kennt, darf Ergebnisse eintragen. Alle anderen können zuschauen.</p>
        <button className="btn" style={{ width: 'calc(100% - 4px)' }} disabled={busy || problems.length > 0 || listState !== 'ok'}>
          {busy ? 'Erstelle …' : 'Turnier starten'}
        </button>
      </form>
    </main>
  );
}

import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { deriveState } from '../lib/tournament.js';
import { nextGroupMatch } from '../lib/stats.js';
import { PHASE_LABEL, dateOf, nameOf, photoUrl, yearOf } from '../lib/format.js';
import { useApp } from '../context.jsx';
import { Dialog, Section, Skeletons } from './ui.jsx';
import { ConfirmDialog, PinDialog } from './Dialogs.jsx';
import HallOfFame from './HallOfFame.jsx';

function AdminTools({ row, onChanged }) {
  const { toast } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [pinInfo, setPinInfo] = useState(null);
  const run = async (fn, okMessage) => {
    try {
      const res = await fn();
      if (okMessage) toast(okMessage);
      onChanged();
      return res;
    } catch (e) {
      toast(e.message, 'bad');
      return null;
    }
  };
  return (
    <div className="btn-row" style={{ margin: '-4px 4px 14px 0' }}>
      <button className="btn small alt" onClick={() => run(() => api.hideTournament(row.id, !row.hidden), row.hidden ? 'Wieder sichtbar' : 'Ausgeblendet')}>
        {row.hidden ? 'Einblenden' : 'Ausblenden'}
      </button>
      <button className="btn small alt" onClick={async () => { const res = await run(() => api.resetPin(row.id)); if (res) setPinInfo(res.pin); }}>
        Neuer PIN
      </button>
      <button className="btn small danger" onClick={() => setConfirm(true)}>
        Löschen
      </button>
      {confirm && (
        <ConfirmDialog
          danger
          title="Turnier löschen?"
          text={`„${row.name || row.id}“ wird endgültig gelöscht, inklusive Foto.`}
          confirmLabel="Löschen"
          onConfirm={() => run(() => api.deleteTournament(row.id), 'Gelöscht')}
          onClose={() => setConfirm(false)}
        />
      )}
      {pinInfo && (
        <Dialog title="Neuer PIN" onClose={() => setPinInfo(null)}>
          <p className="pin-input" style={{ margin: '12px 0' }}>{pinInfo}</p>
          <p className="muted small">Gilt sofort für „{row.name || row.id}“. Gib ihn an die Mitspieler weiter.</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => setPinInfo(null)}>OK</button>
        </Dialog>
      )}
    </div>
  );
}

function ActiveCard({ row, admin, onChanged }) {
  const [doc, setDoc] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.loadTournament(row.id).then((d) => alive && setDoc(d)).catch(() => {});
    load();
    const t = setInterval(() => !document.hidden && load(), 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [row.id]);

  let match = null;
  let note = '';
  if (doc) {
    if (doc.phase === 'group') {
      match = nextGroupMatch(doc);
      note = match ? `Gruppenphase · Runde ${match.round}` : 'Gruppenphase beendet';
    } else {
      const next = deriveState(doc).knockout.find((m) => m.ready && !m.done);
      match = next;
      note = next ? next.label : 'K.O.-Runde läuft';
    }
  }
  return (
    <>
      <div className="banner">
        <span className="eyebrow">LÄUFT · {PHASE_LABEL[row.phase].toUpperCase()}</span>
        <p style={{ marginTop: 8, fontFamily: 'var(--display)' }}>{row.name || `Turnier ${row.id}`}</p>
        {match && doc ? (
          <div className="vs">
            <b>{nameOf(doc, match.homePlayer)}</b>
            <i>VS</i>
            <b>{nameOf(doc, match.awayPlayer)}</b>
          </div>
        ) : (
          <p style={{ margin: '12px 0' }}>{doc ? 'Alle Spiele eingetragen' : 'Lädt …'}</p>
        )}
        {note && <p className="small" style={{ marginBottom: 10 }}>{note} · {row.playerCount} Spieler</p>}
        <button className="btn" onClick={() => navigate(`/t/${row.id}`)}>Turnier öffnen</button>
      </div>
      {admin && <AdminTools row={row} onChanged={onChanged} />}
    </>
  );
}

function ArchiveCard({ row, admin, onChanged }) {
  return (
    <>
      <button className={`card tap ${row.hidden ? 'hidden' : ''}`} onClick={() => navigate(`/t/${row.id}`)}>
        <span className="sticker">{row.hasPhoto ? <img src={photoUrl(row.id, row.photoVersion)} alt="" loading="lazy" /> : '🏆'}</span>
        <span className="grow">
          <span className="year">{yearOf(row.createdAt)}</span>
          <span className="name">{row.winnerName || 'Kein Sieger'}</span>
          <span className="small muted">
            {row.loserName ? `Verlierer: ${row.loserName} · ` : ''}
            {row.playerCount} Spieler · {dateOf(row.createdAt)}
            {row.hidden ? ' · versteckt' : ''}
          </span>
        </span>
        <span aria-hidden>›</span>
      </button>
      {admin && <AdminTools row={row} onChanged={onChanged} />}
    </>
  );
}

export default function Home() {
  const { admin, logoutAdmin } = useApp();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [adminDialog, setAdminDialog] = useState(false);
  const [code, setCode] = useState('');
  const [fullDocs, setFullDocs] = useState([]);

  const load = useCallback(() => {
    api
      .listTournaments()
      .then((r) => {
        setRows(r.tournaments);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 15000);
    return () => clearInterval(t);
  }, [load, admin]);

  const active = (rows || []).filter((r) => r.phase !== 'finished');
  const archive = (rows || []).filter((r) => r.phase === 'finished');
  const archiveKey = archive.map((r) => `${r.id}:${r.updatedAt}`).join('|');

  useEffect(() => {
    let alive = true;
    Promise.all(archive.slice(0, 10).map((r) => api.loadTournament(r.id).catch(() => null))).then((docs) => alive && setFullDocs(docs.filter(Boolean)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveKey]);

  const openByCode = (e) => {
    e.preventDefault();
    const id = code.trim().toUpperCase();
    if (/^[A-NP-Z2-9]{6}$/.test(id)) navigate(`/t/${id}`);
  };

  return (
    <main className="app no-tabs">
      <header style={{ padding: 'calc(22px + env(safe-area-inset-top)) 0 4px' }}>
        <h1 className="logo">Turnier<br />Manager</h1>
        <p className="eyebrow" style={{ marginTop: 8 }}>★ EHRE, WEM EHRE GEBÜHRT ★</p>
      </header>

      {error && <p className="error" role="alert" style={{ marginTop: 14 }}>{error} <button className="link" onClick={load}>Erneut versuchen</button></p>}
      {!rows && !error && <div style={{ marginTop: 18 }}><Skeletons n={2} /></div>}

      {active.length > 0 && (
        <>
          <Section>Läuft gerade</Section>
          {active.map((r) => <ActiveCard key={r.id} row={r} admin={admin} onChanged={load} />)}
        </>
      )}

      {rows && (
        <div style={{ margin: '18px 4px 0 0' }}>
          <button className="btn" onClick={() => navigate('/neu')}>+ Neues Turnier</button>
        </div>
      )}

      {archive.length > 0 && (
        <>
          <Section>Ruhmeshalle</Section>
          {archive.map((r) => <ArchiveCard key={r.id} row={r} admin={admin} onChanged={load} />)}
        </>
      )}
      {rows && archive.length === 0 && active.length === 0 && <p className="empty">Noch keine Turniere. Starte das erste!</p>}

      {fullDocs.length > 0 && (
        <>
          <Section>Ewige Tabelle</Section>
          <HallOfFame docs={fullDocs} />
        </>
      )}

      <Section>Turnier per Code öffnen</Section>
      <form onSubmit={openByCode} className="field" style={{ display: 'flex', gap: 8 }}>
        <input className="input" name="code" id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="z. B. K7M2QX" aria-label="Turnier-Code" autoCapitalize="characters" autoComplete="off" />
        <button className="btn small" style={{ minWidth: 90 }} disabled={code.length !== 6}>Öffnen</button>
      </form>

      <footer className="center" style={{ margin: '28px 0 8px' }}>
        {admin ? (
          <button className="link muted" onClick={logoutAdmin}>Admin aktiv · Abmelden</button>
        ) : (
          <button className="link muted" onClick={() => setAdminDialog(true)}>Admin</button>
        )}
      </footer>
      {adminDialog && <PinDialog adminOnly onSuccess={() => { setAdminDialog(false); load(); }} onClose={() => setAdminDialog(false)} />}
    </main>
  );
}

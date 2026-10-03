import { useState } from 'react';
import { Dialog } from './ui.jsx';
import { verifyPin } from '../lib/api.js';
import { setPin } from '../lib/auth.js';
import { useApp } from '../context.jsx';

/** Fragt den 4-stelligen Turnier-PIN ab (oder den Admin-Code) und merkt ihn sich auf dem Gerät. */
export function PinDialog({ id, onSuccess, onClose, reason, adminOnly = false }) {
  const { loginAdmin } = useApp();
  const [adminMode, setAdminMode] = useState(adminOnly);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (adminMode) {
        await loginAdmin(value);
      } else {
        await verifyPin(id, value);
        setPin(id, value);
      }
      onSuccess();
    } catch (err) {
      setError(err.message);
      setValue('');
    } finally {
      setBusy(false);
    }
  }

  const ready = adminMode ? value.length >= 12 : value.length === 4;
  return (
    <Dialog title={adminMode ? 'Admin-Code' : 'PIN eingeben'} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted small" style={{ margin: '4px 0 14px' }}>
          {reason || (adminMode ? 'Mit dem Admin-Code kannst du jedes Turnier bearbeiten.' : 'Den 4-stelligen PIN hat die Person, die das Turnier erstellt hat. Er bleibt danach 24 Stunden auf diesem Gerät gespeichert.')}
        </p>
        {adminMode ? (
          <input className="input" type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Admin-Code" />
        ) : (
          <input
            className="input pin-input"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="one-time-code"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
            aria-label="PIN mit 4 Ziffern"
            placeholder="····"
          />
        )}
        {error && (
          <p className="error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn alt" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn" disabled={!ready || busy}>
            {busy ? 'Prüfe …' : 'Freischalten'}
          </button>
        </div>
        {!adminOnly && (
          <div className="center" style={{ marginTop: 8 }}>
            <button type="button" className="link" onClick={() => { setAdminMode(!adminMode); setValue(''); setError(''); }}>
              {adminMode ? 'Stattdessen PIN eingeben' : 'Admin-Code verwenden'}
            </button>
          </div>
        )}
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ title, text, confirmLabel = 'OK', danger = false, onConfirm, onClose }) {
  return (
    <Dialog title={title} onClose={onClose}>
      {text && <p style={{ margin: '8px 0 16px' }}>{text}</p>}
      <div className="btn-row">
        <button type="button" className="btn alt" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'danger' : ''}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

/** Ergebnis eintragen: zwei grosse Zähler mit Plus/Minus. */
export function ResultSheet({ home, away, initial, knockout = false, onSave, onClear, onClose, subtitle }) {
  const [h, setH] = useState(initial?.home ?? 0);
  const [a, setA] = useState(initial?.away ?? 0);
  const clamp = (v) => Math.max(0, Math.min(99, v));
  const draw = h === a;
  const blocked = knockout && draw;

  const side = (name, team, value, set) => (
    <div className="stepper">
      <div className="who">
        {name}
        {team && <div className="muted small">{team}</div>}
      </div>
      <div className="num" aria-live="polite" aria-label={`Tore ${name}`}>
        {value}
      </div>
      <div className="pm">
        <button type="button" onClick={() => set(clamp(value - 1))} aria-label={`${name} minus ein Tor`} disabled={value === 0}>
          −
        </button>
        <button type="button" onClick={() => set(clamp(value + 1))} aria-label={`${name} plus ein Tor`}>
          +
        </button>
      </div>
    </div>
  );

  return (
    <Dialog sheet title="Ergebnis eintragen" onClose={onClose}>
      {subtitle && <p className="muted small">{subtitle}</p>}
      <div className="stepper-row">
        {side(home.name, home.team, h, setH)}
        {side(away.name, away.team, a, setA)}
      </div>
      {blocked && <p className="notice">Im K.O. gibt es kein Unentschieden. Wer hat nach Verlängerung oder Penaltyschiessen gewonnen? Trage das Tor für den Sieger ein.</p>}
      <div className="btn-row">
        {onClear && initial && (
          <button type="button" className="btn alt" onClick={onClear}>
            Ergebnis löschen
          </button>
        )}
        <button type="button" className="btn" disabled={blocked} onClick={() => onSave(h, a)}>
          Speichern
        </button>
      </div>
    </Dialog>
  );
}

import { useRef, useState } from 'react';
import { shrinkImage, uploadPhoto } from '../lib/api.js';
import { nameOf, photoUrl, shareMessage, shareOrCopy, teamOf, tournamentUrl, whatsappUrl } from '../lib/format.js';
import { Marks, Section } from './ui.jsx';

const MEDALS = ['🥇', '🥈', '🥉'];

/** Abschluss-Ansicht: Podium, Siegerfoto, Verlierer, Endrangliste. */
export default function Finished({ doc, meta, derived, canEdit, requireEdit, refresh, onError, onReopen }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const ranking = derived.ranking || [];
  const winner = doc.players[doc.winner];
  const loser = doc.players[doc.loser];
  const message = shareMessage(doc, meta);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await uploadPhoto(meta.id, await shrinkImage(file));
      await refresh();
    } catch (err) {
      onError(err.message || 'Foto konnte nicht hochgeladen werden');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="podium">
        <div className="cup" aria-hidden>🏆</div>
        <span className="eyebrow">TURNIERSIEGER</span>
        <h1>{winner?.name}</h1>
        <p className="small">{winner?.team}</p>
      </div>

      <div className="polaroid">
        <div className="pic">{meta.hasPhoto ? <img src={photoUrl(meta.id, meta.photoVersion)} alt={`Siegerfoto: ${winner?.name} und ${loser?.name}`} /> : '📷 Noch kein Siegerfoto'}</div>
        <span>{winner?.name} &amp; {loser?.name}</span>
      </div>
      <div className="center" style={{ marginTop: 14 }}>
        <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
        <button className="btn small alt" disabled={busy} onClick={() => requireEdit(() => input.current?.click())}>
          {busy ? 'Lädt hoch …' : meta.hasPhoto ? '📷 Foto ersetzen' : '📷 Siegerfoto hinzufügen'}
        </button>
      </div>

      {loser && (
        <div className="lose">
          🍋 <strong>{loser.name}</strong> hat das Turnier als Letzter beendet und geht auf die Pressekonferenz. Viel Spass!
        </div>
      )}

      <Section>Endstand</Section>
      {ranking.map((index, i) => (
        <div key={index} className="rk">
          <span className="n">{i + 1}</span>
          <span className="grow">
            {nameOf(doc, index)} <Marks player={doc.players[index]} />
            {teamOf(doc, index) && <small className="muted"> · {teamOf(doc, index)}</small>}
          </span>
          <span aria-hidden>{MEDALS[i] || ''}</span>
        </div>
      ))}

      <div className="btn-row" style={{ margin: '16px 4px 6px 0' }}>
        <a className="btn" href={whatsappUrl(message)} target="_blank" rel="noreferrer">Auf WhatsApp teilen</a>
        <button className="btn alt" onClick={() => shareOrCopy({ title: doc.name, text: message })}>Teilen …</button>
      </div>
      {canEdit && <button className="link" onClick={onReopen}>Turnier wieder öffnen</button>}
    </>
  );
}

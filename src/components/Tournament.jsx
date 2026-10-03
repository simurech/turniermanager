import { useEffect, useMemo, useRef, useState } from 'react';
import { useTournament } from '../lib/sync.js';
import { useHistory } from '../lib/history.js';
import { allGroupPlayed, deriveState, isPlayed, resolveKnockout } from '../lib/tournament.js';
import { headToHead, nextGroupMatch, playerForm, tipText } from '../lib/stats.js';
import { clearPin, getPin, takeJustCreated } from '../lib/auth.js';
import { PHASE_LABEL, copyText, nameOf, shareMessage, shareOrCopy, teamOf, tournamentUrl, whatsappUrl } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { useApp } from '../context.jsx';
import { Dots, Marks, Section, Segmented, Skeletons } from './ui.jsx';
import { ConfirmDialog, PinDialog, ResultSheet } from './Dialogs.jsx';
import StatsTab from './StatsTab.jsx';
import Finished from './Finished.jsx';
import TvView from './TvView.jsx';

const TABS = [
  { id: 'table', icon: '📊', label: 'TABELLE' },
  { id: 'games', icon: '⚽', label: 'SPIELE' },
  { id: 'ko', icon: '🏆', label: 'K.O.' },
  { id: 'stats', icon: '📈', label: 'STATISTIK' },
];

const SYNC_TEXT = { saving: 'Speichert …', offline: 'Offline – neuer Versuch', auth: 'PIN nötig', error: 'Fehler beim Speichern' };

function placeholder(slot, side) {
  if (slot.id === 'final') return `Sieger Halbfinale ${side === 'home' ? 1 : 2}`;
  if (slot.id === 'third') return `Verlierer Halbfinale ${side === 'home' ? 1 : 2}`;
  if (slot.type === 'ladder') return `Sieger Spiel um Platz ${slot.place + 1}`;
  return '?';
}

function MatchButton({ doc, m, onClick, locked = false, tvInfo = false }) {
  const done = isPlayed(m);
  const homeWin = done && m.homeGoals > m.awayGoals;
  const awayWin = done && m.awayGoals > m.homeGoals;
  const side = (index, other) => (index == null ? { name: placeholder(m, other), team: '' } : { name: nameOf(doc, index), team: teamOf(doc, index) });
  const home = side(m.homePlayer, 'home');
  const away = side(m.awayPlayer, 'away');
  return (
    <button type="button" className={`match ${done ? 'done' : ''} ${locked ? 'locked' : ''} ${m.stale ? 'stale' : ''}`} onClick={onClick} disabled={locked}>
      <span className="side">
        <span className={homeWin ? 'win' : ''}>{home.name}</span> <Marks player={doc.players[m.homePlayer]} />
        {home.team && <small>{home.team}</small>}
      </span>
      <span className={`score ${done ? '' : 'open'}`}>{done ? `${m.homeGoals} : ${m.awayGoals}` : tvInfo && m.tv ? `TV ${m.tv}` : 'VS'}</span>
      <span className="side away">
        <span className={awayWin ? 'win' : ''}>{away.name}</span> <Marks player={doc.players[m.awayPlayer]} />
        {away.team && <small>{away.team}</small>}
      </span>
    </button>
  );
}

function StandingsTable({ doc, standings, showQualified }) {
  return (
    <div className="tbl" role="table" aria-label="Tabelle">
      <div className="th" role="row">
        <span>#</span>
        <span>SPIELER</span>
        <span title="Spiele">SP</span>
        <span title="Tordifferenz">TD</span>
        <span style={{ textAlign: 'right' }}>PKT</span>
      </div>
      {standings.map((r, i) => {
        const p = doc.players[r.playerId];
        const form = playerForm(doc, r.playerId, 3);
        return (
          <div key={r.playerId} role="row" className={`tr ${p.champion ? 'champ' : ''} ${p.loserMark ? 'lastrow' : ''} ${showQualified && i < 4 ? 'qual' : ''}`}>
            <span className="rank">{r.rank}</span>
            <span className="who">
              {p.name} <Marks player={p} />
              <small>{p.team || ' '}</small>
              <Dots results={form.results} />
            </span>
            <span>{r.played}</span>
            <span>{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</span>
            <span className="pts">{r.points}</span>
          </div>
        );
      })}
    </div>
  );
}

function NewPinBanner({ pin, doc, meta, onClose }) {
  const [copied, setCopied] = useState(false);
  const message = `⚽ ${doc.name}\nLive verfolgen: ${tournamentUrl(meta.id)}\nPIN zum Eintragen: ${pin}`;
  return (
    <div className="banner calm">
      <span className="eyebrow">TURNIER GESTARTET</span>
      <p style={{ margin: '10px 0 2px' }}>Dein PIN zum Eintragen von Ergebnissen:</p>
      <p className="pin-input" style={{ fontSize: 44, letterSpacing: '0.3em' }}>{pin}</p>
      <p className="small" style={{ margin: '6px 0 12px' }}>Merk ihn dir oder schick ihn der Gruppe. Er wird später nicht mehr angezeigt.</p>
      <div className="btn-row">
        <a className="btn" href={whatsappUrl(message)} target="_blank" rel="noreferrer">An WhatsApp-Gruppe</a>
        <button className="btn alt" onClick={async () => { setCopied(await copyText(message)); }}>{copied ? 'Kopiert ✓' : 'Text kopieren'}</button>
      </div>
      <button className="link" style={{ color: 'var(--paper)', marginTop: 8 }} onClick={onClose}>Verstanden, ausblenden</button>
    </div>
  );
}

export default function Tournament({ id }) {
  const t = useTournament(id);
  const { doc, meta, status, sync, pending, dispatch, retry, refresh } = t;
  const { admin, toast, logoutAdmin } = useApp();
  const history = useHistory(meta?.previousId);
  const [tab, setTab] = useState('table');
  const [filter, setFilter] = useState('all');
  const [pinDialog, setPinDialog] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [justPin, setJustPin] = useState(() => takeJustCreated(id));
  const [tv, setTv] = useState(() => new URLSearchParams(window.location.search).has('tv'));
  const [, forceRender] = useState(0);
  const initialTab = useRef(false);

  const canEdit = admin || Boolean(getPin(id));
  const derived = useMemo(() => (doc ? deriveState(doc) : null), [doc]);

  useEffect(() => {
    if (!doc) return;
    document.title = `${doc.name || 'Turnier'} · Turnier Manager`;
    if (!initialTab.current) {
      initialTab.current = true;
      if (doc.phase === 'knockout') setTab('ko');
    }
  }, [doc]);

  useEffect(() => {
    if (sync.state === 'auth' && !pinDialog) setPinDialog({ after: retry, reason: 'Der PIN wurde nicht akzeptiert oder ist abgelaufen. Bitte erneut eingeben, deine Änderung wird dann gespeichert.' });
  }, [sync.state, pinDialog, retry]);

  if (status === 'loading') return <main className="app no-tabs"><div className="topbar"><span className="logo">Lädt …</span></div><Skeletons n={4} /></main>;
  if (status === 'notfound' || status === 'error') {
    return (
      <main className="app no-tabs">
        <div className="topbar">
          <button className="iconbtn" onClick={() => navigate('/')} aria-label="Zurück">←</button>
        </div>
        <p className="error" role="alert">{status === 'notfound' ? `Das Turnier „${id}“ gibt es nicht (mehr).` : 'Das Turnier konnte nicht geladen werden.'}</p>
        <button className="btn" onClick={() => (status === 'error' ? window.location.reload() : navigate('/'))}>{status === 'error' ? 'Neu laden' : 'Zur Startseite'}</button>
      </main>
    );
  }

  const nextForTv = doc.phase === 'group' ? nextGroupMatch(doc) : derived.knockout.find((m) => m.ready && !m.done) || null;
  if (tv) {
    return <TvView doc={doc} derived={derived} nextMatch={nextForTv} onExit={() => { window.history.replaceState({}, '', `/t/${id}`); setTv(false); }} />;
  }

  const requireEdit = (fn) => (canEdit ? fn() : setPinDialog({ after: fn }));
  const finished = doc.phase === 'finished';
  const nextMatch = doc.phase === 'group' ? nextGroupMatch(doc) : derived.knockout.find((m) => m.ready && !m.done) || null;
  const groupDone = (doc.matches || []).filter(isPlayed).length;

  const openGroup = (m) => {
    if (finished) return toast('Das Turnier ist abgeschlossen. Wieder öffnen, um Ergebnisse zu ändern.');
    const open = () => requireEdit(() => setSheet({ kind: 'group', match: m }));
    if (doc.phase === 'knockout') setConfirm({ title: 'Gruppenergebnis ändern?', text: 'Die K.O.-Runde läuft bereits. Eine Änderung kann die Paarungen verschieben. Betroffene K.O.-Ergebnisse müssen dann neu eingetragen werden.', confirmLabel: 'Trotzdem ändern', onConfirm: open });
    else open();
  };
  const openKo = (m) => {
    if (finished) return toast('Das Turnier ist abgeschlossen. Wieder öffnen, um Ergebnisse zu ändern.');
    if (!m.ready) return;
    requireEdit(() => setSheet({ kind: 'ko', match: m }));
  };

  const save = (h, a) => {
    dispatch({ type: sheet.kind === 'group' ? 'groupResult' : 'koResult', id: sheet.match.id, home: h, away: a });
    setSheet(null);
  };
  const clear = () => {
    dispatch({ type: sheet.kind === 'group' ? 'groupResult' : 'koResult', id: sheet.match.id, home: null, away: null });
    setSheet(null);
  };

  const share = async () => {
    const r = await shareOrCopy({ title: doc.name, text: shareMessage(doc, meta), url: tournamentUrl(id) });
    if (r === 'copied') toast('Link kopiert');
  };

  const syncLabel = sync.state !== 'saved' ? SYNC_TEXT[sync.state] : pending ? 'Speichert …' : canEdit ? '✓ Gespeichert' : '👀 Nur ansehen';
  const syncClass = sync.state === 'saving' || pending ? 'saving' : sync.state === 'saved' ? '' : 'bad';

  const tip = nextMatch && !finished && nextMatch.homePlayer != null ? tipText(doc, history.docs, nextMatch) : null;
  const h2h = nextMatch && nextMatch.homePlayer != null ? headToHead([doc, ...history.docs], nameOf(doc, nextMatch.homePlayer), nameOf(doc, nextMatch.awayPlayer)) : null;

  const groupMatches = (doc.matches || []).filter((m) => (filter === 'open' ? !isPlayed(m) : filter === 'done' ? isPlayed(m) : true));
  const rounds = Map.groupBy(groupMatches, (m) => m.round);

  const koList = doc.phase === 'group' ? resolveKnockout(derived.standings, doc.config, []) : derived.knockout;
  const koGroups = [
    ['Halbfinale', koList.filter((m) => m.type === 'semi')],
    ['Finale und Platz 3', koList.filter((m) => m.type === 'final' || m.type === 'third')],
    ['Plätze 5 bis ' + doc.players.length, koList.filter((m) => m.type === 'ladder')],
  ].filter(([, list]) => list.length);

  return (
    <main className="app">
      <div className="topbar">
        <button className="iconbtn" onClick={() => navigate('/')} aria-label="Zur Startseite">←</button>
        <div className="title">
          <span className="logo">{doc.name || 'Turnier'}</span>
          <span className="eyebrow">CODE {id} · {PHASE_LABEL[doc.phase].toUpperCase()}</span>
        </div>
        <button className="iconbtn" onClick={() => { window.history.replaceState({}, '', `/t/${id}?tv=1`); setTv(true); }} aria-label="TV-Ansicht">📺</button>
        <button className="iconbtn" onClick={share} aria-label="Teilen">📤</button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span className={`sync ${syncClass}`} role="status">{syncLabel}</span>
        {canEdit ? (
          <button className="link" onClick={() => { clearPin(id); if (admin) logoutAdmin(); forceRender((n) => n + 1); }}>🔒 Sperren{admin ? ' (Admin)' : ''}</button>
        ) : (
          <button className="link" onClick={() => setPinDialog({ after: () => forceRender((n) => n + 1) })}>🔓 PIN eingeben</button>
        )}
      </div>

      {justPin && <NewPinBanner pin={justPin} doc={doc} meta={meta} onClose={() => setJustPin(null)} />}

      {tab === 'table' && (
        <>
          {finished && <Finished doc={doc} meta={meta} derived={derived} canEdit={canEdit} requireEdit={requireEdit} dispatch={dispatch} refresh={refresh} onError={(m) => toast(m, 'bad')} onReopen={() => setConfirm({ title: 'Turnier wieder öffnen?', text: 'Sieger und Verlierer werden zurückgesetzt, bis das Turnier erneut abgeschlossen wird.', confirmLabel: 'Wieder öffnen', onConfirm: () => dispatch({ type: 'reopen' }) })} />}

          {!finished && nextMatch && nextMatch.homePlayer != null && (
            <div className="banner">
              <span className="eyebrow">{doc.phase === 'group' ? `NÄCHSTES SPIEL · RUNDE ${nextMatch.round} · TV ${nextMatch.tv}` : `NÄCHSTES SPIEL · ${nextMatch.label.toUpperCase()}`}</span>
              <div className="vs">
                <b>{nameOf(doc, nextMatch.homePlayer)}</b>
                <i>VS</i>
                <b>{nameOf(doc, nextMatch.awayPlayer)}</b>
              </div>
              <button className="btn" onClick={() => (doc.phase === 'group' ? openGroup(nextMatch) : openKo(nextMatch))}>Ergebnis eintragen</button>
            </div>
          )}

          {!finished && tip && (
            <div className="tip">
              <span className="eyebrow">🤖 COMPUTER-TIPP</span>
              <div className="big">{tip.home} {tip.score} {tip.away}</div>
              <div className="bars" style={{ '--a': `${tip.pHome}fr`, '--d': `${tip.pDraw}fr`, '--b': `${tip.pAway}fr` }}><span /><span /><span /></div>
              <div className="small">{tip.verdict} · Sieg {tip.pHome}% · Remis {tip.pDraw}% · Sieg {tip.pAway}%{tip.confidence < 0.4 ? ' · noch wenig Daten' : ''}</div>
              {h2h && h2h.games > 0 && <div className="small" style={{ marginTop: 6 }}>Bisher: {nameOf(doc, nextMatch.homePlayer)} {h2h.winsA} Siege · {h2h.draws} Remis · {nameOf(doc, nextMatch.awayPlayer)} {h2h.winsB} Siege</div>}
            </div>
          )}

          {doc.phase === 'group' && (
            <p className="small muted" style={{ margin: '4px 0 8px' }}>{groupDone} von {doc.matches.length} Spielen gespielt · die ersten 4 kommen weiter (•)</p>
          )}
          <StandingsTable doc={doc} standings={derived.standings} showQualified={doc.phase === 'group'} />

          {doc.phase === 'group' && allGroupPlayed(doc) && (
            <button className="btn green" style={{ width: 'calc(100% - 4px)' }} onClick={() => requireEdit(() => dispatch({ type: 'startKnockout' }))}>K.O.-Runde starten</button>
          )}
          {doc.phase === 'knockout' && (
            <button className="link" onClick={() => requireEdit(() => setConfirm({ title: 'Zurück zur Gruppenphase?', text: 'Alle bisherigen K.O.-Ergebnisse werden gelöscht.', confirmLabel: 'Zurück', danger: true, onConfirm: () => dispatch({ type: 'backToGroup' }) }))}>Zurück zur Gruppenphase</button>
          )}
        </>
      )}

      {tab === 'games' && (
        <>
          <Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Alle' }, { value: 'open', label: 'Offen' }, { value: 'done', label: 'Gespielt' }]} />
          {[...rounds.entries()].map(([round, list]) => (
            <section key={round}>
              <div className="round"><span>RUNDE {round}</span><span>{list.length > 1 ? 'TV 1 + TV 2' : `TV ${list[0].tv}`}</span></div>
              {list.map((m) => <MatchButton key={m.id} doc={doc} m={m} onClick={() => openGroup(m)} tvInfo={doc.config.numTVs > 1} />)}
            </section>
          ))}
          {groupMatches.length === 0 && <p className="empty">Keine Spiele in dieser Ansicht.</p>}
        </>
      )}

      {tab === 'ko' && (
        <>
          {doc.phase === 'group' && <p className="notice">Die K.O.-Runde startet nach der Gruppenphase. So würde sie heute aussehen (Platzierungen können sich noch ändern):</p>}
          {koGroups.map(([title, list]) => (
            <section key={title}>
              <h2 className="section">{title}</h2>
              {list.map((m) => (
                <div key={m.id}>
                  <div className="bracket-label"><span>{m.label.toUpperCase()}</span>{m.stale && <span style={{ color: 'var(--red)' }}>Teilnehmer geändert – neu eintragen</span>}</div>
                  <MatchButton doc={doc} m={m} onClick={() => openKo(m)} locked={doc.phase === 'group' || !m.ready} />
                </div>
              ))}
            </section>
          ))}
          {doc.phase === 'knockout' && derived.ranking && (
            <button className="btn green" style={{ width: 'calc(100% - 4px)', marginTop: 12 }} onClick={() => requireEdit(() => dispatch({ type: 'finish' }))}>Turnier abschliessen</button>
          )}
          {doc.phase === 'knockout' && !derived.ranking && <p className="small muted" style={{ marginTop: 12 }}>Sobald alle K.O.-Spiele gespielt sind, kannst du das Turnier abschliessen.</p>}
        </>
      )}

      {tab === 'stats' && <StatsTab doc={doc} derived={derived} history={history} nextMatch={nextMatch} />}

      {sheet && (
        <ResultSheet
          knockout={sheet.kind === 'ko'}
          subtitle={sheet.kind === 'ko' ? sheet.match.label : `Runde ${sheet.match.round} · TV ${sheet.match.tv}`}
          home={{ name: nameOf(doc, sheet.match.homePlayer), team: teamOf(doc, sheet.match.homePlayer) }}
          away={{ name: nameOf(doc, sheet.match.awayPlayer), team: teamOf(doc, sheet.match.awayPlayer) }}
          initial={isPlayed(sheet.match) ? { home: sheet.match.homeGoals, away: sheet.match.awayGoals } : null}
          onSave={save}
          onClear={clear}
          onClose={() => setSheet(null)}
        />
      )}
      {pinDialog && (
        <PinDialog
          id={id}
          reason={pinDialog.reason}
          onClose={() => setPinDialog(null)}
          onSuccess={() => {
            const after = pinDialog.after;
            setPinDialog(null);
            forceRender((n) => n + 1);
            after?.();
          }}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}

      <nav className="tabbar" aria-label="Bereiche">
        <div className="inner">
          {TABS.map((x) => (
            <button key={x.id} aria-current={tab === x.id ? 'page' : undefined} onClick={() => { setTab(x.id); window.scrollTo(0, 0); }}>
              <i aria-hidden>{x.icon}</i>
              {x.label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTournament } from '../lib/sync.js';
import { useHistory } from '../lib/history.js';
import { allGroupPlayed, deriveState, groupBy, isPlayed, resolveKnockout } from '../lib/tournament.js';
import { headToHead, nextMatches, playerForm, tipText } from '../lib/stats.js';
import { clearPin, getAdmin, getPin, takeJustCreated } from '../lib/auth.js';
import { PHASE_LABEL, copyText, nameOf, shareMessage, shareOrCopy, teamOf, tournamentUrl, whatsappUrl } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { useApp } from '../context.jsx';
import { Dots, Marks, Section, Segmented, Skeletons } from './ui.jsx';
import { ConfirmDialog, PinDialog, PinInfoDialog, ResultSheet } from './Dialogs.jsx';
import StatsTab from './StatsTab.jsx';
import Finished from './Finished.jsx';
import TvView from './TvView.jsx';

const TABS = [
  { id: 'overview', icon: '🏠', label: 'ÜBERSICHT' },
  { id: 'games', icon: '⚽', label: 'SPIELE' },
  { id: 'stats', icon: '📈', label: 'STATISTIK' },
];

const SYNC_TEXT = { saving: 'Speichert …', offline: 'Offline · wird erneut versucht', auth: 'PIN nötig · tippen', error: 'Fehler · tippen zum Wiederholen' };

function MatchButton({ doc, m, onClick, locked = false, tvInfo = false }) {
  const done = isPlayed(m);
  const homeWin = done && m.homeGoals > m.awayGoals;
  const awayWin = done && m.awayGoals > m.homeGoals;
  const side = (index, other) => (index == null ? { name: m.placeholders?.[other] ?? '?', team: '' } : { name: nameOf(doc, index), team: teamOf(doc, index) });
  const home = side(m.homePlayer, 'home');
  const away = side(m.awayPlayer, 'away');
  return (
    <button type="button" className={`match ${done ? 'done' : ''} ${locked ? 'locked' : ''} ${m.stale ? 'stale' : ''}`} onClick={onClick} disabled={locked}>
      <span className="side">
        <span className={homeWin ? 'win' : ''}>{home.name}</span> <Marks player={doc.players[m.homePlayer]} />
        {home.team && <small>{home.team}</small>}
      </span>
      <span className="mid">
        <span className={`score ${done ? '' : 'open'}`}>{done ? `${m.homeGoals} : ${m.awayGoals}` : 'VS'}</span>
        {tvInfo && m.tv && <small className="tvtag">TV {m.tv}</small>}
      </span>
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

function TipCard({ doc, history, match, showTv }) {
  const tip = tipText(doc, history, match);
  const h2h = headToHead([doc, ...history], tip.home, tip.away);
  return (
    <div className="tip">
      <span className="eyebrow">🤖 COMPUTER-TIPP{showTv && match.tv ? ` · TV ${match.tv}` : ''}</span>
      <div className="big">{tip.home} {tip.score} {tip.away}</div>
      <div className="bars" style={{ '--a': `${tip.pHome}fr`, '--d': `${tip.pDraw}fr`, '--b': `${tip.pAway}fr` }}><span /><span /><span /></div>
      <div className="small">{tip.home} {tip.pHome}% · Remis {tip.pDraw}% · {tip.away} {tip.pAway}%</div>
      <div className="small">{tip.verdict}{tip.confidence < 0.4 ? ' · noch wenig Daten' : ''}</div>
      {h2h.games > 0 && <div className="small" style={{ marginTop: 6 }}>Bisher: {tip.home} {h2h.winsA} Siege · {h2h.draws} Remis · {tip.away} {h2h.winsB} Siege</div>}
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
  const { admin, toast, logoutAdmin } = useApp();
  // Ein veralteter Admin-Code auf dem Gerät wird bei einer Ablehnung vergessen, damit er nichts blockiert
  const t = useTournament(id, { onAuthFail: () => { if (getAdmin()) logoutAdmin(); } });
  const { doc, meta, status, sync, pending, dispatch, retry, refresh, notice, clearNotice, connection } = t;
  const history = useHistory(meta?.previousId);
  const [tab, setTab] = useState('overview');
  const [gamesView, setGamesView] = useState('group');
  const [filter, setFilter] = useState('all');
  const [pinDialog, setPinDialog] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [pinInfoOpen, setPinInfoOpen] = useState(false);
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
      setGamesView(doc.phase === 'group' ? 'group' : 'ko');
    }
  }, [doc]);

  // Das PIN-Fenster öffnet sich nur beim Wechsel in den Zustand „PIN nötig“ und lässt sich danach schliessen
  const prevSync = useRef(sync.state);
  useEffect(() => {
    if (sync.state === 'auth' && prevSync.current !== 'auth') {
      setPinDialog({ after: retry, reason: 'Der PIN wurde nicht akzeptiert oder ist abgelaufen. Bitte erneut eingeben, deine Änderung wird dann gespeichert.' });
    }
    prevSync.current = sync.state;
  }, [sync.state, retry]);

  useEffect(() => {
    if (notice) {
      toast(notice, 'bad');
      clearNotice();
    }
  }, [notice, toast, clearNotice]);

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

  const upcoming = nextMatches(doc);
  if (tv) {
    return <TvView doc={doc} derived={derived} upcoming={upcoming} onExit={() => { window.history.replaceState({}, '', `/t/${id}`); setTv(false); }} />;
  }

  const requireEdit = (fn) => (canEdit ? fn() : setPinDialog({ after: fn }));
  const finished = doc.phase === 'finished';
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
    const pairing = sheet.kind === 'ko' ? { homePlayer: sheet.match.homePlayer, awayPlayer: sheet.match.awayPlayer } : {};
    dispatch({ type: sheet.kind === 'group' ? 'groupResult' : 'koResult', id: sheet.match.id, home: h, away: a, ...pairing });
    setSheet(null);
  };
  const clear = () => {
    dispatch({ type: sheet.kind === 'group' ? 'groupResult' : 'koResult', id: sheet.match.id, home: null, away: null });
    setSheet(null);
  };

  const share = async () => {
    const r = await shareOrCopy({ text: shareMessage(doc, meta) });
    if (r === 'copied') toast('Link kopiert');
  };

  const lostSince = connection.lost && connection.since ? new Date(connection.since).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : null;
  const actionable = sync.state === 'auth' || sync.state === 'error' || sync.state === 'offline';
  const syncLabel = sync.state !== 'saved' ? SYNC_TEXT[sync.state] : pending ? 'Speichert …' : connection.lost ? `⚠ Keine Verbindung${lostSince ? ` · Stand ${lostSince}` : ''}` : canEdit ? '✓ Gespeichert' : '👀 Nur ansehen';
  const syncClass = sync.state === 'saving' || pending ? 'saving' : sync.state === 'saved' ? (connection.lost ? 'bad' : '') : 'bad';

  const groupMatches = (doc.matches || []).filter((m) => (filter === 'open' ? !isPlayed(m) : filter === 'done' ? isPlayed(m) : true));
  const rounds = groupBy(groupMatches, (m) => m.round);

  const koList = doc.phase === 'group' ? resolveKnockout(derived.standings, doc.config, []) : derived.knockout;
  const koGroups = [
    ['Halbfinale', koList.filter((m) => m.type === 'semi')],
    ['Finale und Platz 3', koList.filter((m) => m.type === 'final' || m.type === 'third')],
    ['Verlierer-Runde', koList.filter((m) => m.type === 'loserSemi' || m.type === 'loserFinal')],
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
        {actionable ? (
          <button className={`sync ${syncClass}`} onClick={() => (sync.state === 'auth' ? setPinDialog({ after: retry }) : retry())}>{syncLabel}</button>
        ) : (
          <span className={`sync ${syncClass}`} role="status">{syncLabel}</span>
        )}
        {admin && <button className="link" onClick={() => setPinInfoOpen(true)}>🔑 PIN anzeigen</button>}
        {canEdit ? (
          <button className="link" onClick={() => { clearPin(id); if (admin) logoutAdmin(); forceRender((n) => n + 1); }}>🔒 Sperren{admin ? ' (Admin)' : ''}</button>
        ) : (
          <button className="link" onClick={() => setPinDialog({ after: () => forceRender((n) => n + 1) })}>🔓 PIN eingeben</button>
        )}
      </div>

      {justPin && <NewPinBanner pin={justPin} doc={doc} meta={meta} onClose={() => setJustPin(null)} />}

      {tab === 'overview' && (
        <>
          {finished && <Finished doc={doc} meta={meta} derived={derived} canEdit={canEdit} requireEdit={requireEdit} dispatch={dispatch} refresh={refresh} onError={(m) => toast(m, 'bad')} onReopen={() => setConfirm({ title: 'Turnier wieder öffnen?', text: 'Sieger und Verlierer werden zurückgesetzt, bis das Turnier erneut abgeschlossen wird.', confirmLabel: 'Wieder öffnen', onConfirm: () => dispatch({ type: 'reopen' }) })} />}

          {!finished && upcoming.length > 0 && (
            <div className="banner">
              <span className="eyebrow">
                {upcoming.length > 1 ? 'NÄCHSTE SPIELE' : 'NÄCHSTES SPIEL'} · {doc.phase === 'group' ? `RUNDE ${upcoming[0].round}` : 'K.O.-RUNDE'}
              </span>
              {upcoming.map((m) => (
                <div key={m.id} className="nm">
                  <p className="small">{doc.phase === 'group' ? `TV ${m.tv}` : m.label.toUpperCase()}</p>
                  <div className="vs">
                    <b>{nameOf(doc, m.homePlayer)}</b>
                    <i>VS</i>
                    <b>{nameOf(doc, m.awayPlayer)}</b>
                  </div>
                  <button className="btn" onClick={() => (doc.phase === 'group' ? openGroup(m) : openKo(m))}>
                    Ergebnis eintragen{upcoming.length > 1 ? (doc.phase === 'group' ? ` · TV ${m.tv}` : ` · ${m.label}`) : ''}
                  </button>
                </div>
              ))}
            </div>
          )}

          {!finished && upcoming.map((m) => <TipCard key={`tip-${m.id}`} doc={doc} history={history.docs} match={m} showTv={upcoming.length > 1} />)}

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
          <Segmented label="Ansicht" value={gamesView} onChange={setGamesView} options={[{ value: 'group', label: 'Gruppenphase' }, { value: 'ko', label: 'K.O.-Runde' }]} />

          {gamesView === 'group' && (
            <>
              <div style={{ marginTop: 12 }}>
                <Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Alle' }, { value: 'open', label: 'Offen' }, { value: 'done', label: 'Gespielt' }]} />
              </div>
              {[...rounds.entries()].map(([round, list]) => (
                <section key={round}>
                  <div className="round"><span>RUNDE {round}</span><span>{list.length > 1 ? 'TV 1 + TV 2' : `TV ${list[0].tv}`}</span></div>
                  {list.map((m) => <MatchButton key={m.id} doc={doc} m={m} onClick={() => openGroup(m)} tvInfo={doc.config.numTVs > 1} />)}
                </section>
              ))}
              {groupMatches.length === 0 && <p className="empty">Keine Spiele in dieser Ansicht.</p>}
            </>
          )}

          {gamesView === 'ko' && (
            <>
              {doc.phase === 'group' && <p className="notice" style={{ marginTop: 12 }}>Die K.O.-Runde startet nach der Gruppenphase. So würde sie heute aussehen (Platzierungen können sich noch ändern):</p>}
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
              {doc.phase === 'group' && allGroupPlayed(doc) && (
                <button className="btn green" style={{ width: 'calc(100% - 4px)', marginTop: 12 }} onClick={() => requireEdit(() => dispatch({ type: 'startKnockout' }))}>K.O.-Runde starten</button>
              )}
              {doc.phase === 'knockout' && derived.ranking && (
                <button className="btn green" style={{ width: 'calc(100% - 4px)', marginTop: 12 }} onClick={() => requireEdit(() => dispatch({ type: 'finish' }))}>Turnier abschliessen</button>
              )}
              {doc.phase === 'knockout' && !derived.ranking && <p className="small muted" style={{ marginTop: 12 }}>Sobald alle K.O.-Spiele gespielt sind, kannst du das Turnier abschliessen.</p>}
            </>
          )}
        </>
      )}

      {tab === 'stats' && <StatsTab doc={doc} derived={derived} history={history} />}

      {sheet && (
        <ResultSheet
          knockout={sheet.kind === 'ko'}
          subtitle={sheet.kind === 'ko' ? sheet.match.label : `Runde ${sheet.match.round} · TV ${sheet.match.tv}`}
          home={{ name: nameOf(doc, sheet.match.homePlayer), team: teamOf(doc, sheet.match.homePlayer) }}
          away={{ name: nameOf(doc, sheet.match.awayPlayer), team: teamOf(doc, sheet.match.awayPlayer) }}
          initial={isPlayed(sheet.match) ? { home: sheet.match.homeGoals, away: sheet.match.awayGoals } : null}
          onSave={save}
          onClear={sheet.kind === 'group' && doc.phase !== 'group' ? undefined : clear}
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
      {pinInfoOpen && <PinInfoDialog id={id} name={doc.name || id} onClose={() => setPinInfoOpen(false)} />}

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

// Lädt ein Turnier, hält es aktuell (Polling) und speichert Änderungen.
//
// Änderungen sind kleine Operationen (`applyOp`). Das angezeigte Dokument ist immer
// Serverstand + noch nicht gespeicherte Operationen. Bei einem Versionskonflikt wird der neue
// Serverstand geladen und die eigenen Operationen werden erneut darauf angewendet.
//
// Sicherheitsnetz: Offene Operationen werden auf dem Gerät zwischengespeichert, beim Verlassen der Seite
// gewarnt und nach Fehlern automatisch erneut gesendet. Nicht übernommene Eingaben werden gemeldet.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { applyOpsReport, applyOps } from './tournament.js';
import { clearPin, touchPin } from './auth.js';

const POLL_MS = 6000;
const SAVE_DELAY_MS = 250;
const OFFLINE_RETRY_MS = 4000;
const ERROR_RETRY_MS = 8000;
const LOAD_RETRY_MS = 10000;
const OPS_TTL_MS = 24 * 60 * 60 * 1000;

const opsKey = (id) => `tm:ops:${id}`;

function loadStoredOps(id) {
  try {
    const raw = localStorage.getItem(opsKey(id));
    if (!raw) return [];
    const { ts, ops } = JSON.parse(raw);
    if (Array.isArray(ops) && typeof ts === 'number' && Date.now() - ts < OPS_TTL_MS) return ops;
    localStorage.removeItem(opsKey(id));
  } catch {
    /* Speicher nicht verfügbar */
  }
  return [];
}

function storeOps(id, ops) {
  try {
    if (ops.length) localStorage.setItem(opsKey(id), JSON.stringify({ ts: Date.now(), ops }));
    else localStorage.removeItem(opsKey(id));
  } catch {
    /* Speicher nicht verfügbar: dann gilt nur der Arbeitsspeicher */
  }
}

export function useTournament(id, { onAuthFail } = {}) {
  const [server, setServer] = useState(null);
  const [ops, setOps] = useState(() => loadStoredOps(id));
  const [status, setStatus] = useState('loading'); // loading | ready | notfound | error
  const [sync, setSync] = useState({ state: 'saved', message: '' }); // saved | saving | offline | auth | error
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState({ lost: false, since: null });

  const serverRef = useRef(null);
  const opsRef = useRef(ops);
  const busy = useRef(false);
  const timer = useRef(null);
  const saves = useRef(0); // zählt abgeschlossene Speicherungen, um veraltete Abfragen zu erkennen
  const pollFails = useRef(0);
  const lastOk = useRef(null);
  const flushRef = useRef(() => {});
  const authFailRef = useRef(onAuthFail);
  authFailRef.current = onAuthFail;

  const putServer = useCallback((doc) => {
    serverRef.current = doc;
    setServer(doc);
  }, []);

  const setPending = useCallback(
    (next) => {
      opsRef.current = next;
      setOps(next);
      storeOps(id, next);
    },
    [id],
  );

  const schedule = useCallback((ms) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), ms);
  }, []);

  const flush = useCallback(async () => {
    if (busy.current || !opsRef.current.length || !serverRef.current) return;
    busy.current = true;
    setSync({ state: 'saving', message: '' });
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const snapshot = opsRef.current.slice();
        const base = serverRef.current;
        const { doc, dropped } = applyOpsReport(base, snapshot);
        if (dropped.length) {
          setNotice(dropped.length === 1 ? 'Eine Eingabe wurde nicht übernommen, weil sich Paarung oder Phase inzwischen geändert haben. Bitte prüfen.' : `${dropped.length} Eingaben wurden nicht übernommen, weil sich Paarungen oder Phase inzwischen geändert haben. Bitte prüfen.`);
        }
        if (doc === base) {
          // Nichts zu speichern (alle Eingaben waren hinfällig)
          setPending(opsRef.current.slice(snapshot.length));
          if (!opsRef.current.length) {
            setSync({ state: 'saved', message: '' });
            return;
          }
          continue;
        }
        try {
          const res = await api.updateTournament(id, base.version, doc);
          saves.current++;
          putServer({ ...doc, version: res.version, updatedAt: res.updatedAt });
          setPending(opsRef.current.slice(snapshot.length));
          touchPin(id);
          if (!opsRef.current.length) {
            setSync({ state: 'saved', message: '' });
            return;
          }
        } catch (e) {
          if (e.status === 409 && e.data?.current) {
            putServer(e.data.current);
            continue;
          }
          if (e.status === 401 || e.status === 403) {
            clearPin(id);
            authFailRef.current?.(e);
            setSync({ state: 'auth', message: e.message });
          } else if (e.status === 404) {
            setPending([]);
            setStatus('notfound');
          } else if (e.status === 400 || e.status === 413) {
            // Der Server lehnt diese Daten endgültig ab: nicht endlos wiederholen
            setPending(opsRef.current.slice(snapshot.length));
            setNotice(`Die Änderung wurde vom Server abgelehnt: ${e.message}`);
            setSync({ state: 'saved', message: '' });
          } else if (e.status === 0) {
            setSync({ state: 'offline', message: e.message });
            schedule(OFFLINE_RETRY_MS);
          } else {
            const wait = e.status === 429 && e.data?.retryAfter ? Math.min(60000, Math.max(ERROR_RETRY_MS, e.data.retryAfter * 1000)) : ERROR_RETRY_MS;
            setSync({ state: 'error', message: e.message });
            schedule(wait);
          }
          return;
        }
      }
      setSync({ state: 'error', message: 'Zu viele gleichzeitige Änderungen. Wird erneut versucht.' });
      schedule(ERROR_RETRY_MS);
    } finally {
      busy.current = false;
    }
  }, [id, putServer, schedule, setPending]);
  flushRef.current = flush;

  const dispatch = useCallback(
    (op) => {
      setPending([...opsRef.current, op]);
      schedule(SAVE_DELAY_MS);
    },
    [schedule, setPending],
  );

  /** Holt den Serverstand. Veraltete Antworten (während einer Speicherung oder älter als der lokale Stand) werden ignoriert. */
  const refresh = useCallback(async () => {
    const savesBefore = saves.current;
    const res = await api.loadTournament(id);
    if (busy.current || opsRef.current.length || saves.current !== savesBefore) return res;
    if (!serverRef.current || res.version > serverRef.current.version) putServer(res);
    return res;
  }, [id, putServer]);

  const loadInitial = useCallback(() => {
    return api
      .loadTournament(id)
      .then((res) => {
        putServer(res);
        lastOk.current = Date.now();
        setStatus('ready');
      })
      .catch((e) => setStatus(e.status === 404 || e.status === 400 ? 'notfound' : 'error'));
  }, [id, putServer]);

  useEffect(() => {
    setStatus('loading');
    loadInitial();
    return () => {
      clearTimeout(timer.current);
      // Offene Eingaben beim Verlassen der Seite noch absenden
      if (opsRef.current.length) flushRef.current();
    };
  }, [id, loadInitial]);

  // Gespeicherte Eingaben aus einer früheren Sitzung senden, sobald der Serverstand da ist
  useEffect(() => {
    if (status === 'ready' && opsRef.current.length) schedule(SAVE_DELAY_MS);
  }, [status, schedule]);

  // Erster Ladeversuch fehlgeschlagen (z. B. kurzes WLAN-Problem am Fernseher): selbst erneut versuchen
  useEffect(() => {
    if (status !== 'error') return undefined;
    const retry = setInterval(loadInitial, LOAD_RETRY_MS);
    return () => clearInterval(retry);
  }, [status, loadInitial]);

  useEffect(() => {
    const poll = () => {
      if (document.hidden || busy.current || opsRef.current.length || !serverRef.current) return;
      refresh()
        .then(() => {
          pollFails.current = 0;
          lastOk.current = Date.now();
          setConnection((c) => (c.lost ? { lost: false, since: null } : c));
        })
        .catch((e) => {
          if (e.status === 404) {
            setStatus('notfound');
            return;
          }
          pollFails.current++;
          if (pollFails.current >= 2) setConnection((c) => (c.lost ? c : { lost: true, since: lastOk.current }));
        });
    };
    const wake = () => {
      flushRef.current();
      poll();
    };
    const interval = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [refresh]);

  // Warnung beim Schliessen oder Neuladen, solange noch nicht alles gespeichert ist
  useEffect(() => {
    if (!ops.length) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [ops.length]);

  const doc = useMemo(() => (server ? applyOps(server, ops) : null), [server, ops]);
  const clearNotice = useCallback(() => setNotice(''), []);
  return { doc, meta: server, status, sync, pending: ops.length, dispatch, retry: flush, refresh, notice, clearNotice, connection };
}

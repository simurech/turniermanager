// Lädt ein Turnier, hält es aktuell (Polling) und speichert Änderungen.
//
// Änderungen sind kleine Operationen (`applyOp`). Das angezeigte Dokument ist immer
// Serverstand + noch nicht gespeicherte Operationen. Bei einem Versionskonflikt wird der neue
// Serverstand geladen und die eigenen Operationen werden erneut darauf angewendet.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { applyOps } from './tournament.js';
import { clearPin, touchPin } from './auth.js';

const POLL_MS = 6000;
const SAVE_DELAY_MS = 250;
const RETRY_MS = 4000;

export function useTournament(id) {
  const [server, setServer] = useState(null);
  const [ops, setOps] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | notfound | error
  const [sync, setSync] = useState({ state: 'saved', message: '' }); // saved | saving | offline | auth | error

  const serverRef = useRef(null);
  const opsRef = useRef([]);
  const busy = useRef(false);
  const timer = useRef(null);

  const putServer = useCallback((doc) => {
    serverRef.current = doc;
    setServer(doc);
  }, []);

  const flush = useCallback(async () => {
    if (busy.current || !opsRef.current.length || !serverRef.current) return;
    busy.current = true;
    setSync({ state: 'saving', message: '' });
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const snapshot = opsRef.current.slice();
        const base = serverRef.current;
        const doc = applyOps(base, snapshot);
        try {
          const res = await api.updateTournament(id, base.version, doc);
          putServer({ ...doc, version: res.version, updatedAt: res.updatedAt });
          opsRef.current = opsRef.current.slice(snapshot.length);
          setOps(opsRef.current);
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
            setSync({ state: 'auth', message: e.message });
          } else if (e.status === 0) {
            setSync({ state: 'offline', message: e.message });
            timer.current = setTimeout(flush, RETRY_MS);
          } else {
            setSync({ state: 'error', message: e.message });
          }
          return;
        }
      }
      setSync({ state: 'error', message: 'Zu viele gleichzeitige Änderungen. Bitte erneut versuchen.' });
    } finally {
      busy.current = false;
    }
  }, [id, putServer]);

  const dispatch = useCallback(
    (op) => {
      opsRef.current = [...opsRef.current, op];
      setOps(opsRef.current);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const refresh = useCallback(async () => {
    const res = await api.loadTournament(id);
    if (!serverRef.current || res.version !== serverRef.current.version) putServer(res);
    return res;
  }, [id, putServer]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api
      .loadTournament(id)
      .then((res) => {
        if (cancelled) return;
        putServer(res);
        setStatus('ready');
      })
      .catch((e) => {
        if (!cancelled) setStatus(e.status === 404 || e.status === 400 ? 'notfound' : 'error');
      });
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [id, putServer]);

  useEffect(() => {
    const poll = () => {
      if (document.hidden || busy.current || opsRef.current.length || !serverRef.current) return;
      refresh().catch(() => {});
    };
    const interval = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [refresh]);

  const doc = useMemo(() => (server ? applyOps(server, ops) : null), [server, ops]);
  return { doc, meta: server, status, sync, pending: ops.length, dispatch, retry: flush, refresh };
}

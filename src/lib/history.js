// Lädt die Kette der Vorgänger-Turniere (previousId) für Statistik, Tipp und Quoten.
import { useEffect, useRef, useState } from 'react';
import { loadTournament } from './api.js';

const CACHE_MS = 5 * 60 * 1000;
const MAX_CHAIN = 5;
const cache = new Map();

async function loadCached(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.doc;
  const doc = await loadTournament(id);
  cache.set(id, { doc, t: Date.now() });
  return doc;
}

/**
 * Gibt die Vorgänger zurück, nächster zuerst. Ein gelöschter Vorgänger (404) beendet die Kette.
 * Bei anderen Fehlern (Netzwerk, Server) ist die Kette `incomplete` und wird später erneut geladen.
 */
export async function loadChain(previousId) {
  const docs = [];
  const seen = new Set();
  let incomplete = false;
  let next = previousId;
  while (next && docs.length < MAX_CHAIN && !seen.has(next)) {
    seen.add(next);
    try {
      const doc = await loadCached(next);
      docs.push(doc);
      next = doc.previousId;
    } catch (e) {
      incomplete = e.status !== 404;
      break;
    }
  }
  return { docs, incomplete };
}

/** Vorgänger kommen aus der Export-Datei (`embedded`, Gast) oder werden über previousId vom Server geladen (Admin). */
export function useHistory(previousId, embedded) {
  const [state, setState] = useState({ docs: embedded?.length ? embedded : [], loading: !embedded?.length && Boolean(previousId), incomplete: false });
  // Die Export-Daten ändern sich nie. Ein Verweis genügt, damit nicht jede Aktualisierung des Turniers neu rechnet.
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;
  const embeddedCount = embedded?.length || 0;
  useEffect(() => {
    let cancelled = false;
    let timer;
    if (embeddedCount) {
      setState({ docs: embeddedRef.current, loading: false, incomplete: false });
      return undefined;
    }
    if (!previousId) {
      setState({ docs: [], loading: false, incomplete: false });
      return undefined;
    }
    const attempt = (n) => {
      loadChain(previousId).then(({ docs, incomplete }) => {
        if (cancelled) return;
        setState({ docs, loading: false, incomplete });
        if (incomplete && n < 3) timer = setTimeout(() => attempt(n + 1), 8000);
      });
    };
    setState((s) => ({ ...s, loading: true }));
    attempt(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previousId, embeddedCount]);
  return state;
}

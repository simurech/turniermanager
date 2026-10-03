// Lädt die Kette der Vorgänger-Turniere (previousId) für Statistik, Tipp und Quoten.
import { useEffect, useState } from 'react';
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

/** Gibt die Vorgänger zurück, nächster zuerst. Fehlende oder gelöschte Vorgänger beenden die Kette. */
export async function loadChain(previousId) {
  const docs = [];
  const seen = new Set();
  let next = previousId;
  while (next && docs.length < MAX_CHAIN && !seen.has(next)) {
    seen.add(next);
    try {
      const doc = await loadCached(next);
      docs.push(doc);
      next = doc.previousId;
    } catch {
      break;
    }
  }
  return docs;
}

export function useHistory(previousId) {
  const [state, setState] = useState({ docs: [], loading: Boolean(previousId) });
  useEffect(() => {
    let cancelled = false;
    if (!previousId) {
      setState({ docs: [], loading: false });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    loadChain(previousId).then((docs) => {
      if (!cancelled) setState({ docs, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [previousId]);
  return state;
}

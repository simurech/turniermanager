// Minimaler Router über die History-API.
//   /            Startseite (Übersicht und Archiv)
//   /neu         Neues Turnier
//   /t/ABC123    Turnier
// Alte Links der Form /?turnier=ABC123 werden weitergeleitet.
import { useEffect, useState } from 'react';

const ID_PATTERN = /^[A-NP-Z2-9]{6}$/;

export function parseRoute(loc = window.location) {
  const legacy = new URLSearchParams(loc.search).get('turnier');
  if (legacy && ID_PATTERN.test(legacy.toUpperCase())) return { name: 'tournament', id: legacy.toUpperCase(), legacy: true };
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  if (path === '/neu') return { name: 'new' };
  const match = path.match(/^\/t\/([A-Za-z0-9]{6})$/);
  if (match) return { name: 'tournament', id: match[1].toUpperCase() };
  return { name: 'home' };
}

export function navigate(path, { replace = false } = {}) {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.dispatchEvent(new Event('tm:navigate'));
  window.scrollTo(0, 0);
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute());
  useEffect(() => {
    const update = () => setRoute(parseRoute());
    window.addEventListener('popstate', update);
    window.addEventListener('tm:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('tm:navigate', update);
    };
  }, []);
  useEffect(() => {
    if (route.legacy) {
      const rest = new URLSearchParams(window.location.search);
      rest.delete('turnier');
      navigate(`/t/${route.id}${rest.toString() ? `?${rest}` : ''}`, { replace: true });
    }
  }, [route]);
  return route;
}

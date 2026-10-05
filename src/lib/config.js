// Name, Untertitel, Farben und Fristen dieser Installation (aus config.php, vom Einrichtungsskript geschrieben).
// Die letzte Antwort wird auf dem Gerät gemerkt und beim Start sofort angewendet, damit die Seite nicht umspringt.
import { useSyncExternalStore } from 'react';

const KEY = 'tm:config';

export const DEFAULT_CONFIG = {
  appName: 'Turnier Manager',
  subline: '★ WER IST DER FIFA GOTT? ★',
  colors: { paper: '#f2e8cf', ink: '#1d2b53', red: '#c8372d', green: '#2f6b3a', mustard: '#e8a921' },
  guestHours: 48,
  finishedHours: 12,
  repoUrl: '',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Mischt zwei Hex-Farben. t = Anteil von b. */
export function mix(a, b, t) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Alle Farbvariablen der Oberfläche aus den fünf Grundfarben. */
export function themeVars(colors) {
  const { paper, ink, red, green, mustard } = colors;
  return {
    '--paper': paper,
    '--paper2': mix(paper, '#000000', 0.06),
    '--card': mix(paper, '#ffffff', 0.7),
    '--ink': ink,
    '--red': red,
    '--green': green,
    '--mustard': mustard,
    '--muted': mix(ink, paper, 0.3),
    '--page': mix(paper, '#000000', 0.15),
  };
}

/** Ergänzt fehlende oder ungültige Werte mit den Standardwerten. */
export function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const colors = {};
  for (const [k, def] of Object.entries(DEFAULT_CONFIG.colors)) colors[k] = typeof r.colors?.[k] === 'string' && HEX.test(r.colors[k]) ? r.colors[k] : def;
  const hours = (v, def) => (Number.isInteger(v) && v >= 0 ? v : def);
  return {
    appName: typeof r.appName === 'string' && r.appName.trim() ? r.appName.trim() : DEFAULT_CONFIG.appName,
    subline: typeof r.subline === 'string' ? r.subline : DEFAULT_CONFIG.subline,
    colors,
    guestHours: hours(r.guestHours, DEFAULT_CONFIG.guestHours),
    finishedHours: hours(r.finishedHours, DEFAULT_CONFIG.finishedHours),
    repoUrl: typeof r.repoUrl === 'string' && /^https:\/\//.test(r.repoUrl) ? r.repoUrl : '',
  };
}

function applyTheme(config) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVars(config.colors))) root.style.setProperty(name, value);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', config.colors.ink);
}

function readCache() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return DEFAULT_CONFIG;
  }
}

let current = readCache();
const listeners = new Set();

function set(next) {
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  current = next;
  applyTheme(current);
  if (changed) listeners.forEach((fn) => fn());
}

/** Wendet die gemerkte Konfiguration an (vor der ersten Darstellung) und holt danach die aktuelle vom Server. */
export function initConfig() {
  applyTheme(current);
  fetch('/api.php?action=config', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      const next = sanitize(data);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ohne Speicher gilt die Konfiguration nur für diese Sitzung */
      }
      set(next);
    })
    .catch(() => {});
}

export const getConfig = () => current;
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const useConfig = () => useSyncExternalStore(subscribe, getConfig);

/** Seitentitel mit App-Name. */
export const pageTitle = (part) => (part ? `${part} · ${current.appName}` : current.appName);

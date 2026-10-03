// Merkt sich Turnier-PINs (24 h) und den Admin-Code (30 Tage) auf dem Gerät.
// Läuft auch, wenn localStorage nicht verfügbar ist (dann nur bis zum Neuladen der Seite).

export const PIN_TTL = 24 * 60 * 60 * 1000;
export const ADMIN_TTL = 30 * 24 * 60 * 60 * 1000;

const memory = new Map();
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};

function readSecret(key, ttl, now = Date.now()) {
  const raw = store.get(key);
  if (!raw) return null;
  try {
    const { v, t } = JSON.parse(raw);
    if (typeof v === 'string' && typeof t === 'number' && now - t < ttl) return v;
  } catch {
    /* kaputter Eintrag */
  }
  store.remove(key);
  return null;
}

const writeSecret = (key, value) => store.set(key, JSON.stringify({ v: value, t: Date.now() }));

export const getPin = (id) => readSecret(`tm:pin:${id}`, PIN_TTL);
export const setPin = (id, pin) => writeSecret(`tm:pin:${id}`, pin);
export const clearPin = (id) => store.remove(`tm:pin:${id}`);
/** Verlängert die Gültigkeit nach einer erfolgreichen Änderung. */
export const touchPin = (id) => {
  const pin = getPin(id);
  if (pin) setPin(id, pin);
};

export const getAdmin = () => readSecret('tm:admin', ADMIN_TTL);
export const setAdmin = (code) => writeSecret('tm:admin', code);
export const clearAdmin = () => store.remove('tm:admin');

export const canEditStored = (id) => Boolean(getAdmin() || getPin(id));

/** Header für die API: Admin-Code und/oder PIN des Turniers. */
export function authHeaders(id) {
  const headers = {};
  const admin = getAdmin();
  if (admin) headers['X-Admin'] = admin;
  const pin = id ? getPin(id) : null;
  if (pin) headers['X-Pin'] = pin;
  return headers;
}

/** Einmalig angezeigter PIN direkt nach dem Erstellen (nur für diese Sitzung). */
export const rememberJustCreated = (id, pin) => {
  try {
    sessionStorage.setItem(`tm:new:${id}`, pin);
  } catch {
    memory.set(`tm:new:${id}`, pin);
  }
};
export const takeJustCreated = (id) => {
  try {
    return sessionStorage.getItem(`tm:new:${id}`) ?? memory.get(`tm:new:${id}`) ?? null;
  } catch {
    return memory.get(`tm:new:${id}`) ?? null;
  }
};

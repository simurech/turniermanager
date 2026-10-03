// Dünne Schicht über public/api.php. Zugangsdaten werden automatisch aus auth.js mitgesendet.
import { authHeaders } from './auth.js';

export const DATA_KEYS = ['name', 'config', 'players', 'matches', 'standings', 'knockoutMatches', 'phase', 'winner', 'loser'];

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(action, { method = 'POST', query = {}, body, form, id, headers = {}, auth = true } = {}) {
  const params = new URLSearchParams({ action, ...query });
  const allHeaders = { ...(auth ? authHeaders(id) : {}), ...headers };
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    allHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api.php?${params}`, { method, headers: allHeaders, body: payload, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Fehler ${res.status}`, data);
  // Eine Erfolgsantwort ohne gültiges JSON (z. B. Fehlertext des Servers davor) gilt nicht als gespeichert
  if (data === null || typeof data !== 'object') throw new ApiError(502, 'Ungültige Antwort vom Server. Bitte erneut versuchen.');
  return data;
}

export const pickData = (doc) => Object.fromEntries(DATA_KEYS.filter((k) => k in doc).map((k) => [k, doc[k]]));

export const listTournaments = () => request('list', { method: 'GET' });
// Leere Objekte kommen vom Server als leere Liste zurück. Die App erwartet für `config` ein Objekt.
const normalize = (doc) => (Array.isArray(doc?.config) ? { ...doc, config: {} } : doc);
export const loadTournament = (id) => request('load', { method: 'GET', query: { id }, auth: false }).then(normalize);
export const createTournament = ({ data, previousId, previousPin }) =>
  request('create', { body: { data: pickData(data), previousId: previousId || null, previousPin: previousPin || null } });
export const updateTournament = (id, version, data) => request('update', { id, body: { id, version, data: pickData(data) } });
export const verifyPin = (id, pin) => request('verify', { method: 'POST', query: { id }, auth: false, headers: { 'X-Pin': pin } });
export const verifyAdmin = (code) => request('admin_check', { auth: false, headers: { 'X-Admin': code } });
export const hideTournament = (id, hidden) => request('hide', { id, body: { id, hidden } });
export const deleteTournament = (id) => request('delete', { id, body: { id } });
export const resetPin = (id) => request('reset_pin', { id, body: { id } });
export const getPin = (id) => request('get_pin', { id, body: { id } });

export function uploadPhoto(id, blob) {
  const form = new FormData();
  form.append('photo', blob, 'foto.jpg');
  return request('photo', { query: { id }, id, form });
}

/** Lädt ein Bild als Bitmap oder, wo das nicht geht (ältere Browser), über ein Bild-Element. */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        /* weiter mit dem Bild-Element */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Verkleinert ein Foto im Browser auf max. 1200 px und kodiert es als JPEG. */
export async function shrinkImage(file, maxSize = 1200, quality = 0.82) {
  let image;
  try {
    image = await decodeImage(file);
  } catch {
    throw new Error('Dieses Foto kann nicht verarbeitet werden. Bitte ein anderes wählen (JPEG oder PNG).');
  }
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Das Foto konnte nicht verarbeitet werden.'))), 'image/jpeg', quality));
}

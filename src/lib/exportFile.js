// Export und Import eines abgeschlossenen Turniers als Datei. Gäste (ohne Admin-Code) sichern damit ihr Turnier,
// bevor es nach 48 Stunden gelöscht wird, und übernehmen es beim nächsten Turnier als Vorjahr.
import { DATA_KEYS } from './api.js';
import { deriveState } from './tournament.js';
import { dateOf, nameOf } from './format.js';

const FORMAT = 'turniermanager-export';
const MAX_CHAIN = 5;

const slim = (doc) => ({
  ...Object.fromEntries(DATA_KEYS.filter((k) => k in doc).map((k) => [k, doc[k]])),
  ...(doc.createdAt ? { createdAt: doc.createdAt } : {}),
  ...(doc.finishedAt ? { finishedAt: doc.finishedAt } : {}),
});

/** Inhalt der Export-Datei: das Turnier und seine Vorgänger (damit auch ältere Jahre erhalten bleiben). */
export function buildExport(doc, meta, history = []) {
  return {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    tournament: slim({ ...doc, createdAt: meta?.createdAt, finishedAt: meta?.finishedAt }),
    history: history.slice(0, MAX_CHAIN - 1).map(slim),
  };
}

export function exportFileName(doc) {
  const slug = (doc.name || 'turnier').toLowerCase().replace(/[^a-z0-9äöüéèà]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'turnier'}.turnier.json`;
}

export function downloadExport(doc, meta, history) {
  const blob = new Blob([JSON.stringify(buildExport(doc, meta, history), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(doc);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const isFinished = (d) => d && d.phase === 'finished' && Array.isArray(d.players) && d.players.length >= 2 && Array.isArray(d.matches);

/** Liest eine Export-Datei. Gibt { tournament, chain } zurück (chain: Turnier und Vorgänger, neuestes zuerst) oder wirft einen Fehler mit lesbarer Meldung. */
export function parseExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Das ist keine gültige Export-Datei.');
  }
  if (data?.format !== FORMAT || !isFinished(data.tournament)) {
    throw new Error('Das ist keine Export-Datei eines abgeschlossenen Turniers.');
  }
  const chain = [data.tournament, ...(Array.isArray(data.history) ? data.history : [])].filter(isFinished).slice(0, MAX_CHAIN).map(slim);
  return { tournament: chain[0], chain };
}

/** Lesbare Zusammenfassung zum Teilen oder Aufbewahren. */
export function resultsText(doc) {
  const { ranking, knockout } = deriveState(doc);
  const line = (m) => `${nameOf(doc, m.homePlayer)} ${m.homeGoals} : ${m.awayGoals} ${nameOf(doc, m.awayPlayer)}`;
  const out = [`🏆 ${doc.name || 'Turnier'}`, ''];
  if (ranking?.length) {
    out.push('Endstand');
    ranking.forEach((index, i) => out.push(`${i + 1}. ${nameOf(doc, index)}`));
    out.push('');
  }
  const group = (doc.matches || []).filter((m) => m.homeGoals != null);
  if (group.length) out.push('Gruppenphase', ...group.map(line), '');
  const ko = (knockout || []).filter((m) => m.homeGoals != null);
  if (ko.length) out.push('K.O.-Runde', ...ko.map((m) => `${m.label}: ${line(m)}`), '');
  return out.join('\n').trim();
}

export const expiryText = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${dateOf(iso)} um ${d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })} Uhr`;
};

export const PHASE_LABEL = { setup: 'Vorbereitung', group: 'Gruppenphase', knockout: 'K.O.-Runde', finished: 'Abgeschlossen' };

export const yearOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.getFullYear();
};

export const dateOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const photoUrl = (id, version) => `/photos/${id}.jpg?v=${version || 0}`;
export const tournamentUrl = (id) => `${window.location.origin}/t/${id}`;
export const nameOf = (doc, index) => doc.players[index]?.name ?? '?';
export const teamOf = (doc, index) => doc.players[index]?.team || '';
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Kurzer Text zum Teilen. */
export function shareMessage(doc, meta) {
  const url = tournamentUrl(meta.id);
  if (doc.phase === 'finished' && doc.players[doc.winner]) {
    const loser = doc.players[doc.loser]?.name;
    return `🏆 ${doc.name || 'Turnier'}: ${doc.players[doc.winner].name} ist Turniersieger!${loser ? ` 🍋 ${loser} geht auf die Pressekonferenz.` : ''}\n${url}`;
  }
  return `⚽ ${doc.name || 'Turnier'} – live verfolgen:\n${url}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Teilt über das System-Menü, sonst Zwischenablage. Gibt 'shared' | 'copied' | 'failed' zurück.
 * Der Link steht bereits im Text. Er darf nicht zusätzlich als `url` übergeben werden, sonst erscheint er doppelt.
 */
export async function shareOrCopy({ title, text }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'shared';
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

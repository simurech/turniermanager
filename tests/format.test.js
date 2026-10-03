import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shareMessage, shareOrCopy, whatsappUrl } from '../src/lib/format.js';

const URL_TEXT = 'https://turniermanager.urech.dev/t/D4IABX';
const count = (text, part) => text.split(part).length - 1;

describe('Teilen', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://turniermanager.urech.dev' } });
  });
  afterEach(() => vi.unstubAllGlobals());

  const running = { name: 'Turnier 03.10.2026', phase: 'group', players: [{ name: 'A' }, { name: 'B' }], winner: null, loser: null };
  const finished = { ...running, phase: 'finished', winner: 0, loser: 1 };

  it('der Link steht genau einmal im Text, bei laufendem und beendetem Turnier', () => {
    expect(count(shareMessage(running, { id: 'D4IABX' }), URL_TEXT)).toBe(1);
    const done = shareMessage(finished, { id: 'D4IABX' });
    expect(count(done, URL_TEXT)).toBe(1);
    expect(done).toContain('A ist Turniersieger');
    expect(done).toContain('B geht auf die Pressekonferenz');
  });

  it('die System-Freigabe bekommt den Link nur im Text und nicht zusätzlich als url', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    const text = shareMessage(running, { id: 'D4IABX' });
    expect(await shareOrCopy({ title: running.name, text, url: URL_TEXT })).toBe('shared');
    const arg = share.mock.calls[0][0];
    expect(arg.url).toBeUndefined();
    expect(count(arg.text, URL_TEXT)).toBe(1);
  });

  it('ohne System-Freigabe wird der Text kopiert, der Link ebenfalls nur einmal', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const text = shareMessage(running, { id: 'D4IABX' });
    expect(await shareOrCopy({ title: 'x', text })).toBe('copied');
    expect(count(writeText.mock.calls[0][0], URL_TEXT)).toBe(1);
  });

  it('WhatsApp-Link enthält den Text einmal kodiert', () => {
    const link = whatsappUrl(shareMessage(running, { id: 'D4IABX' }));
    expect(link.startsWith('https://wa.me/?text=')).toBe(true);
    expect(count(decodeURIComponent(link), URL_TEXT)).toBe(1);
  });
});

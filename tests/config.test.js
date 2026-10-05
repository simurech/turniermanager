import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, mix, sanitize, themeVars } from '../src/lib/config.js';

describe('Konfiguration', () => {
  it('mischt Farben', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
  });

  it('ergänzt fehlende und ungültige Werte mit den Standardwerten', () => {
    expect(sanitize(null)).toEqual(DEFAULT_CONFIG);
    const c = sanitize({ appName: '  Mein Cup ', subline: '', colors: { red: '#112233', ink: 'blau' }, guestHours: -1, finishedHours: 0, repoUrl: 'javascript:alert(1)' });
    expect(c.appName).toBe('Mein Cup');
    expect(c.subline).toBe('');
    expect(c.colors.red).toBe('#112233');
    expect(c.colors.ink).toBe(DEFAULT_CONFIG.colors.ink);
    expect(c.guestHours).toBe(48);
    expect(c.finishedHours).toBe(0);
    expect(c.repoUrl).toBe('');
  });

  it('leitet alle Farbvariablen ab', () => {
    const vars = themeVars(DEFAULT_CONFIG.colors);
    for (const name of ['--paper', '--paper2', '--card', '--ink', '--red', '--green', '--mustard', '--muted', '--page']) expect(vars[name]).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--paper']).toBe('#f2e8cf');
  });
});

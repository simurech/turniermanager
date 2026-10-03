import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPin, getPin, touchPin, clearPin, setAdmin, getAdmin, clearAdmin, authHeaders, canEditStored, PIN_TTL, ADMIN_TTL } from '../src/lib/auth.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('PIN- und Admin-Speicher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T08:00:00Z'));
    clearPin('ABC234');
    clearAdmin();
  });
  afterEach(() => vi.useRealTimers());

  it('PIN gilt mindestens 24 Stunden', () => {
    setPin('ABC234', '1234');
    vi.advanceTimersByTime(23 * HOUR + 59 * 60 * 1000);
    expect(getPin('ABC234')).toBe('1234');
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(getPin('ABC234')).toBeNull();
  });

  it('PIN ist an das Turnier gebunden', () => {
    setPin('ABC234', '1234');
    expect(getPin('XYZ789')).toBeNull();
  });

  it('erfolgreiches Speichern verlängert die Gültigkeit', () => {
    setPin('ABC234', '1234');
    vi.advanceTimersByTime(20 * HOUR);
    touchPin('ABC234');
    vi.advanceTimersByTime(20 * HOUR);
    expect(getPin('ABC234')).toBe('1234');
  });

  it('Admin-Code gilt 30 Tage', () => {
    setAdmin('ein-langer-admin-code');
    vi.advanceTimersByTime(29 * DAY);
    expect(getAdmin()).toBe('ein-langer-admin-code');
    vi.advanceTimersByTime(2 * DAY);
    expect(getAdmin()).toBeNull();
  });

  it('Header enthalten nur gültige Zugangsdaten', () => {
    expect(authHeaders('ABC234')).toEqual({});
    setPin('ABC234', '4321');
    expect(authHeaders('ABC234')).toEqual({ 'X-Pin': '4321' });
    setAdmin('ein-langer-admin-code');
    expect(authHeaders('ABC234')).toEqual({ 'X-Admin': 'ein-langer-admin-code', 'X-Pin': '4321' });
    expect(authHeaders(null)).toEqual({ 'X-Admin': 'ein-langer-admin-code' });
    vi.advanceTimersByTime(PIN_TTL + HOUR);
    expect(authHeaders('ABC234')).toEqual({ 'X-Admin': 'ein-langer-admin-code' });
  });

  it('canEditStored: Admin oder PIN', () => {
    expect(canEditStored('ABC234')).toBe(false);
    setPin('ABC234', '1111');
    expect(canEditStored('ABC234')).toBe(true);
    expect(canEditStored('OTHER2')).toBe(false);
    setAdmin('ein-langer-admin-code');
    expect(canEditStored('OTHER2')).toBe(true);
  });

  it('TTL-Konstanten entsprechen den Vorgaben', () => {
    expect(PIN_TTL).toBe(24 * HOUR);
    expect(ADMIN_TTL).toBe(30 * DAY);
  });
});

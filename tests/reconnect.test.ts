import { describe, expect, it } from 'vitest';
import { isGitSyncWindowOpen, reconnectDelaySeconds, shouldScheduleGitSync } from '../src/index.js';
import type { Config } from '../src/config.js';

const cfg = {
  reconnectInitialSeconds: 30,
  reconnectMaxSeconds: 90,
  reconnectMultiplier: 2,
  reconnectJitterSeconds: 0,
} as Config;

describe('reconnect backoff', () => {
  it('uses exponential delays and caps at the configured maximum', () => {
    expect(reconnectDelaySeconds(cfg, 1, () => 0)).toBe(30);
    expect(reconnectDelaySeconds(cfg, 2, () => 0)).toBe(60);
    expect(reconnectDelaySeconds(cfg, 3, () => 0)).toBe(90);
    expect(reconnectDelaySeconds(cfg, 10, () => 0)).toBe(90);
  });
  it('lets local-only mode override automatic Git scheduling', () => {
    expect(shouldScheduleGitSync({ gitSyncEnabled: true, localOnlyMode: true } as Config)).toBe(false);
    expect(shouldScheduleGitSync({ gitSyncEnabled: true, localOnlyMode: false } as Config)).toBe(true);
  });
  it('allows automatic sync only from 07:00 through 22:59 in the configured timezone', () => {
    expect(isGitSyncWindowOpen(new Date('2026-08-06T01:29:00.000Z'), 'Asia/Kolkata')).toBe(false);
    expect(isGitSyncWindowOpen(new Date('2026-08-06T01:30:00.000Z'), 'Asia/Kolkata')).toBe(true);
    expect(isGitSyncWindowOpen(new Date('2026-08-06T17:29:00.000Z'), 'Asia/Kolkata')).toBe(true);
    expect(isGitSyncWindowOpen(new Date('2026-08-06T17:30:00.000Z'), 'Asia/Kolkata')).toBe(false);
  });
});

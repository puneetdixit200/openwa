import { describe, expect, it } from 'vitest';
import { reconnectDelaySeconds, shouldScheduleGitSync } from '../src/index.js';
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
});

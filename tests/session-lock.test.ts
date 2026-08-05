import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireSessionLock, sessionLockPath } from '../src/session-lock.js';

describe('OpenWA session lock', () => {
  it('rejects an active owner and releases cleanly', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwa-session-lock-'));
    const first = await acquireSessionLock(root, 'collector');
    await expect(acquireSessionLock(root, 'groups-select')).rejects.toThrow(/already in use/);
    await first.release();
    const second = await acquireSessionLock(root, 'auth');
    await second.release();
  });

  it('recovers a stale lock without killing a process', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwa-session-lock-'));
    await fs.mkdir(path.dirname(sessionLockPath(root)), { recursive: true });
    await fs.writeFile(
      sessionLockPath(root),
      JSON.stringify({ pid: 2147483647, startedAt: new Date().toISOString(), command: 'auth' }),
    );
    const lock = await acquireSessionLock(root, 'groups-list');
    await lock.release();
    await expect(fs.access(sessionLockPath(root))).rejects.toThrow();
  });
});

import fs from 'node:fs/promises';
import path from 'node:path';

export type SessionLockCommand = 'collector' | 'auth' | 'groups-list' | 'groups-select';
type LockRecord = { pid: number; startedAt: string; command: SessionLockCommand };

function pidIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function sessionLockPath(runtimeDir: string) {
  return path.join(runtimeDir, 'locks', 'openwa-session.lock');
}

export async function acquireSessionLock(runtimeDir: string, command: SessionLockCommand) {
  const file = sessionLockPath(runtimeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const record: LockRecord = { pid: process.pid, startedAt: new Date().toISOString(), command };
  for (;;) {
    try {
      const handle = await fs.open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(record));
      await handle.close();
      let released = false;
      return {
        path: file,
        async release() {
          if (released) return;
          released = true;
          await fs.unlink(file).catch(() => {});
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let existing: LockRecord | undefined;
      try {
        existing = JSON.parse(await fs.readFile(file, 'utf8')) as LockRecord;
      } catch {
        await fs.unlink(file).catch(() => {});
        continue;
      }
      if (Number.isInteger(existing.pid) && pidIsAlive(existing.pid))
        throw new Error(`OpenWA session is already in use by ${existing.command} process ${existing.pid}`);
      await fs.unlink(file).catch(() => {});
    }
  }
}

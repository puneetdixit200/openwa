import 'dotenv/config';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { atomicWrite, safeErrorMessage } from './utils.js';

const exec = promisify(execFile);

export type WatchdogMemory = {
  healthFailures: number;
  notReadyChecks: number;
  automaticRestarts: number;
  lastState: string | null;
};

export type WatchdogProbe = {
  healthReachable: boolean;
  connectionState?: string;
  listenerActive?: boolean;
};

export type WatchdogDecision = {
  memory: WatchdogMemory;
  events: string[];
  restart: boolean;
};

export const emptyWatchdogMemory = (): WatchdogMemory => ({
  healthFailures: 0,
  notReadyChecks: 0,
  automaticRestarts: 0,
  lastState: null,
});

export function decideWatchdog(probe: WatchdogProbe, previous: WatchdogMemory): WatchdogDecision {
  const next: WatchdogMemory = { ...previous };
  const events: string[] = [];
  let restart = false;

  if (!probe.healthReachable) {
    next.healthFailures += 1;
    next.notReadyChecks = 0;
    if (previous.lastState !== 'unreachable' && previous.lastState !== 'gave-up') events.push('unreachable');
    next.lastState = 'unreachable';
    if (next.healthFailures >= 3) {
      next.healthFailures = 0;
      if (next.automaticRestarts < 3) {
        next.automaticRestarts += 1;
        events.push('watchdog-restart');
        restart = true;
      } else if (previous.lastState !== 'gave-up') {
        events.push('watchdog-gave-up');
        next.lastState = 'gave-up';
      }
    }
    return { memory: next, events, restart };
  }

  next.healthFailures = 0;
  const connectionState = probe.connectionState ?? 'unknown';
  const ready = connectionState === 'connected' && probe.listenerActive === true;

  if (ready) {
    if (previous.lastState && previous.lastState !== 'ready') events.push('recovered');
    next.lastState = 'ready';
    next.notReadyChecks = 0;
    next.automaticRestarts = 0;
    return { memory: next, events, restart: false };
  }

  if (connectionState === 'auth_required') {
    if (previous.lastState !== 'auth_required') events.push('auth-required');
    next.lastState = 'auth_required';
    next.notReadyChecks = 0;
    return { memory: next, events, restart: false };
  }

  if (connectionState === 'offline' || connectionState === 'reconnecting') {
    if (!['offline', 'reconnecting'].includes(previous.lastState ?? '')) events.push('offline');
    next.lastState = connectionState;
    next.notReadyChecks = 0;
    return { memory: next, events, restart: false };
  }

  if (connectionState === 'error' || connectionState === 'stopped') {
    next.notReadyChecks += 1;
    if (previous.lastState !== connectionState && previous.lastState !== 'gave-up') events.push('failed');
    next.lastState = connectionState;
    if (next.notReadyChecks >= 2) {
      next.notReadyChecks = 0;
      if (next.automaticRestarts < 3) {
        next.automaticRestarts += 1;
        events.push('watchdog-restart');
        restart = true;
      } else if (previous.lastState !== 'gave-up') {
        events.push('watchdog-gave-up');
        next.lastState = 'gave-up';
      }
    }
    return { memory: next, events, restart };
  }

  next.notReadyChecks += 1;
  if (next.notReadyChecks >= 3) {
    if (previous.lastState !== 'not-ready') events.push('not-ready');
    next.lastState = 'not-ready';
  } else {
    next.lastState = connectionState;
  }
  return { memory: next, events, restart: false };
}

async function loadMemory(file: string): Promise<WatchdogMemory> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<WatchdogMemory>;
    return {
      healthFailures: Number.isInteger(parsed.healthFailures) ? Number(parsed.healthFailures) : 0,
      notReadyChecks: Number.isInteger(parsed.notReadyChecks) ? Number(parsed.notReadyChecks) : 0,
      automaticRestarts: Number.isInteger(parsed.automaticRestarts) ? Number(parsed.automaticRestarts) : 0,
      lastState: typeof parsed.lastState === 'string' ? parsed.lastState : null,
    };
  } catch {
    return emptyWatchdogMemory();
  }
}

function localProbeHost(host: string) {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

async function probeHealth() {
  const host = localProbeHost(process.env.HEALTH_SERVER_HOST || '127.0.0.1');
  const port = Number(process.env.HEALTH_SERVER_PORT || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid HEALTH_SERVER_PORT');
  const response = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`health endpoint returned HTTP ${response.status}`);
  const body = (await response.json()) as { connectionState?: unknown; listenerActive?: unknown };
  return {
    healthReachable: true,
    connectionState: typeof body.connectionState === 'string' ? body.connectionState : 'unknown',
    listenerActive: body.listenerActive === true,
  } satisfies WatchdogProbe;
}

async function notify(repo: string, event: string) {
  await exec(path.join(repo, 'scripts', 'notify-collector.sh'), [event], { cwd: repo }).catch(() => {});
}

async function restartCollector() {
  await exec('systemctl', ['--user', 'reset-failed', 'placement-collector.service']).catch(() => {});
  await exec('systemctl', ['--user', 'restart', 'placement-collector.service']);
}

export async function runWatchdog(repo = process.cwd()) {
  const runtimeDir = path.resolve(repo, process.env.RUNTIME_DIRECTORY || './runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  const stateFile = path.join(runtimeDir, 'watchdog-state.json');
  const previous = await loadMemory(stateFile);

  let probe: WatchdogProbe;
  try {
    probe = await probeHealth();
  } catch {
    probe = { healthReachable: false };
  }

  const decision = decideWatchdog(probe, previous);
  for (const event of decision.events) await notify(repo, event);

  if (decision.restart) {
    try {
      await restartCollector();
    } catch (error) {
      decision.memory.automaticRestarts = 3;
      decision.memory.lastState = 'gave-up';
      await notify(repo, 'watchdog-gave-up');
      console.error(`watchdog restart failed: ${safeErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }

  await atomicWrite(stateFile, `${JSON.stringify(decision.memory, null, 2)}\n`);
  console.log(
    JSON.stringify({
      healthReachable: probe.healthReachable,
      connectionState: probe.connectionState ?? 'unreachable',
      restartRequested: decision.restart,
      automaticRestarts: decision.memory.automaticRestarts,
    }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))
  await runWatchdog();

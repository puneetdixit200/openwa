import path from 'node:path';
import { spawn } from 'node:child_process';
import pino from 'pino';
import { loadConfig, prepareLocalDirectories, checkLocalPreflight } from './config.js';
import {
  createOpenWa,
  allowedMessage,
  isAuthRequiredError,
  shouldIgnoreMessage,
  normalise,
  type IncomingMessage,
  type OpenWaClient,
} from './openwa.js';
import { StateStore, writeMessage, dateFolder } from './storage.js';
import { saveAttachment } from './attachment.js';
import { closeServer, startServer, type RuntimeStatus } from './server.js';
import { syncGit, pendingGitFileCount } from './git.js';
import { acquireSessionLock } from './session-lock.js';
import type { Config } from './config.js';
import { safeErrorMessage } from './utils.js';

class ConnectionLostError extends Error {}

type ConnectionAlert = 'auth-required' | 'offline' | null;

export function reconnectDelaySeconds(cfg: Config, attempt: number, random = Math.random) {
  const base = Math.min(
    cfg.reconnectMaxSeconds,
    cfg.reconnectInitialSeconds * cfg.reconnectMultiplier ** Math.max(0, attempt - 1),
  );
  const jitter = cfg.reconnectJitterSeconds ? Math.floor(random() * (cfg.reconnectJitterSeconds + 1)) : 0;
  return Math.min(cfg.reconnectMaxSeconds, base + jitter);
}

export function shouldScheduleGitSync(cfg: Config) {
  return cfg.gitSyncEnabled && !cfg.localOnlyMode;
}

export function isGitSyncWindowOpen(date: Date, timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(date),
  );
  return hour >= 7 && hour < 23;
}

function notifyDesktop(cfg: Config, event: string) {
  try {
    const child = spawn(path.join(cfg.codeRepoPath, 'scripts', 'notify-collector.sh'), [event], {
      stdio: 'ignore',
      detached: true,
    });
    // Notification delivery must never be capable of crashing the collector.
    child.on('error', () => {});
    child.unref();
  } catch {
    // The persistent journal/log path remains the source of truth if desktop notification launch itself fails.
  }
}

function wait(ms: number, stop: Promise<void>) {
  return Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), stop]);
}

async function waitForClient(client: OpenWaClient, stop: Promise<void>) {
  let timer: NodeJS.Timeout | undefined;
  const lost = new Promise<never>((_resolve, reject) => {
    const stateChanged = (state: string) => {
      if (/unpaired|logged.?out|disconnect|auth|conflict/i.test(state)) reject(new ConnectionLostError(state));
    };
    void client.onStateChanged?.(stateChanged);
    if (client.isConnected) {
      timer = setInterval(() => {
        void Promise.resolve(client.isConnected?.())
          .then((connected) => {
            if (!connected) reject(new ConnectionLostError('WhatsApp connection lost'));
          })
          .catch((error) => reject(new ConnectionLostError((error as Error).message)));
      }, 30_000);
      timer.unref?.();
    }
  });
  try {
    await Promise.race([lost, stop]);
  } finally {
    if (timer) clearInterval(timer);
  }
}

export async function startCollector() {
  const cfg = loadConfig();
  await prepareLocalDirectories(cfg);
  await checkLocalPreflight(cfg);
  const log = pino({ level: cfg.logLevel });
  const state = new StateStore(cfg);
  await state.load();
  const status: RuntimeStatus = {
    connectionState: 'starting',
    whatsappConnected: false,
    listenerActive: false,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastReconnectAttemptAt: null,
    nextReconnectAt: null,
    reconnectAttempt: 0,
    lastMessageReceivedAt: null,
    lastGitSyncAt: null,
    lastGitSyncStatus: 'never',
    lastGitSyncError: null,
    pendingGitFileCount: 0,
    startedAt: Date.now(),
    activeGroupCount: cfg.groupIds.length || cfg.groupNames.length,
    lastSafeError: null,
    unreadReplayRunning: false,
    unreadReplayCompletedAt: null,
    inFlightMessages: 0,
    lastMessageProcessedAt: null,
    lastStorageErrorAt: null,
  };

  const server = cfg.healthEnabled ? await startServer(cfg, status) : undefined;
  let lock: Awaited<ReturnType<typeof acquireSessionLock>>;
  try {
    lock = await acquireSessionLock(cfg.runtimeDir, 'collector');
  } catch (error) {
    status.connectionState = 'error';
    status.lastSafeError = safeErrorMessage(error);
    log.error({ error: safeErrorMessage(error) }, 'WhatsApp session is already in use');
    notifyDesktop(cfg, 'failed');
    await closeServer(server);
    throw error;
  }

  let activeClient: OpenWaClient | undefined;
  let stopping = false;
  let gitTimer: NodeJS.Timeout | undefined;
  let gitBusy = false;
  let lastConnectionAlert: ConnectionAlert = null;
  let resolveStop!: () => void;
  const stop = new Promise<void>((resolve) => (resolveStop = resolve));

  const updatePendingGitFiles = async () => {
    status.pendingGitFileCount = await pendingGitFileCount(cfg).catch(() => 0);
  };

  const runGitSync = async (immediate = false) => {
    if (gitBusy || !shouldScheduleGitSync(cfg) || (!immediate && !isGitSyncWindowOpen(new Date(), cfg.timezone)))
      return;
    gitBusy = true;
    try {
      const result = await syncGit(cfg);
      status.lastGitSyncAt = new Date().toISOString();
      status.lastGitSyncStatus = result.status;
      status.lastGitSyncError = null;
      await updatePendingGitFiles();
      if (result.status === 'success') notifyDesktop(cfg, 'sync-success');
      log.info({ status: result.status }, 'git sync complete');
    } catch (error) {
      status.lastGitSyncAt = new Date().toISOString();
      status.lastGitSyncStatus = 'error';
      status.lastGitSyncError = safeErrorMessage(error);
      await updatePendingGitFiles();
      notifyDesktop(cfg, 'sync-failed');
      log.error({ error: safeErrorMessage(error) }, 'git sync failed; local collection continues');
    } finally {
      gitBusy = false;
    }
  };

  const save = async (raw: IncomingMessage) => {
    if (!allowedMessage(raw, cfg) || shouldIgnoreMessage(raw)) {
      log.debug('ignored message outside the configured read-only allowlist');
      return;
    }
    const msg = normalise(raw, cfg);
    if (state.has(msg.messageId)) {
      log.debug({ messageId: msg.messageId.slice(0, 8) }, 'duplicate skipped');
      return;
    }
    const receivedDate = new Date(msg.timestamp);
    const folder = await dateFolder(cfg, receivedDate);
    msg.attachment = await saveAttachment(cfg, activeClient ?? {}, raw, folder);
    await writeMessage(cfg, msg, receivedDate);
    await state.add(msg.messageId);
    status.lastMessageReceivedAt = msg.receivedAt;
    status.lastMessageProcessedAt = new Date().toISOString();
    void updatePendingGitFiles();
    // Raw data is already durable at this point. Request an immediate sync for
    // each saved message; any Git failure remains non-fatal and is retried by
    // the periodic timer.
    void runGitSync(true);
    log.info({ messageId: msg.messageId.slice(0, 8), type: msg.type }, 'message saved');
  };

  if (shouldScheduleGitSync(cfg)) {
    if (isGitSyncWindowOpen(new Date(), cfg.timezone)) void runGitSync();
    gitTimer = setInterval(() => void runGitSync(), cfg.gitIntervalMinutes * 60_000);
    gitTimer.unref?.();
  }

  const connectionLoop = async () => {
    while (!stopping) {
      status.connectionState = status.reconnectAttempt ? 'reconnecting' : 'connecting';
      status.lastReconnectAttemptAt = new Date().toISOString();
      status.nextReconnectAt = null;
      let client: OpenWaClient | undefined;
      try {
        client = await createOpenWa(cfg);
        activeClient = client;
        status.whatsappConnected = true;
        status.listenerActive = false;
        status.unreadReplayRunning = false;
        status.connectionState = 'connected';
        status.lastConnectedAt = new Date().toISOString();
        status.reconnectAttempt = 0;
        await client.onMessage(async (raw) => {
          status.inFlightMessages += 1;
          try {
            await save(raw);
          } catch (error) {
            status.lastSafeError = safeErrorMessage(error);
            status.lastStorageErrorAt = new Date().toISOString();
            notifyDesktop(cfg, 'storage-failed');
            log.error({ error: safeErrorMessage(error) }, 'message processing failed');
          } finally {
            status.inFlightMessages = Math.max(0, status.inFlightMessages - 1);
            status.lastMessageProcessedAt = new Date().toISOString();
          }
        });
        status.listenerActive = true;
        log.info('WhatsApp listener active');
        if (cfg.emitUnread && client.emitUnreadMessages) {
          status.connectionState = 'replaying_unread';
          status.unreadReplayRunning = true;
          try {
            await client.emitUnreadMessages();
            const drainDeadline = Date.now() + 30_000;
            while (status.inFlightMessages > 0 && Date.now() < drainDeadline)
              await new Promise((resolve) => setTimeout(resolve, 100));
            if (status.inFlightMessages > 0) throw new Error('unread replay processing did not drain before timeout');
            status.unreadReplayCompletedAt = new Date().toISOString();
          } catch (error) {
            status.lastSafeError = safeErrorMessage(error);
            status.lastStorageErrorAt = new Date().toISOString();
            notifyDesktop(cfg, 'replay-failed');
            log.error({ error: safeErrorMessage(error) }, 'unread replay failed; live listener remains active');
          }
          status.unreadReplayRunning = false;
          status.connectionState = 'connected';
        }
        if (lastConnectionAlert) {
          notifyDesktop(cfg, 'recovered');
          lastConnectionAlert = null;
        }
        await waitForClient(client, stop);
        if (stopping) break;
        throw new ConnectionLostError('WhatsApp connection lost');
      } catch (error) {
        if (stopping) break;
        await client?.close?.().catch(() => {});
        activeClient = undefined;
        status.whatsappConnected = false;
        status.listenerActive = false;
        status.unreadReplayRunning = false;
        status.lastDisconnectedAt = new Date().toISOString();
        if (isAuthRequiredError(error)) {
          status.connectionState = 'auth_required';
          status.lastSafeError = 'WhatsApp authentication required; run npm run auth';
          if (lastConnectionAlert !== 'auth-required') notifyDesktop(cfg, 'auth-required');
          lastConnectionAlert = 'auth-required';
          log.warn(status.lastSafeError);
        } else {
          status.connectionState = 'offline';
          status.lastSafeError = safeErrorMessage(error);
          if (lastConnectionAlert !== 'offline') notifyDesktop(cfg, 'offline');
          lastConnectionAlert = 'offline';
          log.warn({ error: safeErrorMessage(error) }, 'WhatsApp unavailable; local service remains alive');
        }
        if (!cfg.autoReconnect) {
          status.connectionState = 'error';
          notifyDesktop(cfg, 'failed');
          break;
        }
        status.reconnectAttempt += 1;
        const delay = isAuthRequiredError(error) ? 900 : reconnectDelaySeconds(cfg, status.reconnectAttempt);
        status.nextReconnectAt = new Date(Date.now() + delay * 1000).toISOString();
        await wait(delay * 1000, stop);
      }
    }
  };

  const shutdown = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    status.connectionState = 'stopped';
    status.whatsappConnected = false;
    status.listenerActive = false;
    resolveStop();
    if (gitTimer) clearInterval(gitTimer);
    await activeClient?.close?.().catch(() => {});
    await lock.release();
    await closeServer(server);
    process.exit(code);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.once('uncaughtException', (error) => {
    log.fatal({ error: safeErrorMessage(error) }, 'uncaught exception');
    notifyDesktop(cfg, 'failed');
    void shutdown(1);
  });
  process.once('unhandledRejection', (error) => {
    log.fatal({ error: safeErrorMessage(error) }, 'unhandled rejection');
    notifyDesktop(cfg, 'failed');
    void shutdown(1);
  });
  void connectionLoop();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))
  await startCollector();

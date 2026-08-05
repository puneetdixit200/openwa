import path from 'node:path';
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
  };

  const server = cfg.healthEnabled ? await startServer(cfg, status) : undefined;
  const lock = await acquireSessionLock(cfg.runtimeDir, 'collector').catch((error) => {
    status.connectionState = 'error';
    status.lastSafeError = safeErrorMessage(error);
    log.error({ error: safeErrorMessage(error) }, 'OpenWA session is already in use');
    return undefined;
  });
  if (!lock) return;

  let activeClient: OpenWaClient | undefined;
  let stopping = false;
  let gitTimer: NodeJS.Timeout | undefined;
  let gitBusy = false;
  let resolveStop!: () => void;
  const stop = new Promise<void>((resolve) => (resolveStop = resolve));

  const updatePendingGitFiles = async () => {
    status.pendingGitFileCount = await pendingGitFileCount(cfg).catch(() => 0);
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
    void updatePendingGitFiles();
    log.info({ messageId: msg.messageId.slice(0, 8), type: msg.type }, 'message saved');
  };

  const runGitSync = async () => {
    if (gitBusy || !shouldScheduleGitSync(cfg)) return;
    gitBusy = true;
    try {
      const result = await syncGit(cfg);
      status.lastGitSyncAt = new Date().toISOString();
      status.lastGitSyncStatus = result.status;
      status.lastGitSyncError = null;
      await updatePendingGitFiles();
      log.info({ status: result.status }, 'git sync complete');
    } catch (error) {
      status.lastGitSyncAt = new Date().toISOString();
      status.lastGitSyncStatus = 'error';
      status.lastGitSyncError = safeErrorMessage(error);
      await updatePendingGitFiles();
      log.error({ error: safeErrorMessage(error) }, 'git sync failed; local collection continues');
    } finally {
      gitBusy = false;
    }
  };

  if (shouldScheduleGitSync(cfg)) {
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
        status.connectionState = 'connected';
        status.lastConnectedAt = new Date().toISOString();
        status.reconnectAttempt = 0;
        await client.onMessage(async (raw) => {
          try {
            await save(raw);
          } catch (error) {
            status.lastSafeError = safeErrorMessage(error);
            log.error({ error: safeErrorMessage(error) }, 'message processing failed');
          }
        });
        status.listenerActive = true;
        log.info('WhatsApp listener active');
        if (cfg.emitUnread && client.emitUnreadMessages) {
          status.connectionState = 'replaying_unread';
          try {
            await client.emitUnreadMessages();
          } catch (error) {
            status.lastSafeError = safeErrorMessage(error);
            log.error({ error: safeErrorMessage(error) }, 'unread replay failed; live listener remains active');
          }
          status.connectionState = 'connected';
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
        status.lastDisconnectedAt = new Date().toISOString();
        if (isAuthRequiredError(error)) {
          status.connectionState = 'auth_required';
          status.lastSafeError = 'WhatsApp authentication required; run npm run auth';
          log.warn(status.lastSafeError);
        } else {
          status.connectionState = 'offline';
          status.lastSafeError = safeErrorMessage(error);
          log.warn({ error: safeErrorMessage(error) }, 'WhatsApp unavailable; local service remains alive');
        }
        if (!cfg.autoReconnect) {
          status.connectionState = 'error';
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
    void shutdown(1);
  });
  process.once('unhandledRejection', (error) => {
    log.fatal({ error: safeErrorMessage(error) }, 'unhandled rejection');
    void shutdown(1);
  });
  void connectionLoop();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))
  await startCollector();

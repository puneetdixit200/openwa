import path from 'node:path';
import pino from 'pino';
import { loadConfig, prepareLocalDirectories } from './config.js';
import {
  createOpenWa,
  allowedMessage,
  shouldIgnoreMessage,
  normalise,
  type IncomingMessage,
  type OpenWaClient,
} from './openwa.js';
import { StateStore, writeMessage, dateFolder } from './storage.js';
import { saveAttachment } from './attachment.js';
import { startServer, type RuntimeStatus } from './server.js';
import { syncGit } from './git.js';
export async function startCollector() {
  const cfg = loadConfig();
  await prepareLocalDirectories(cfg);
  const log = pino({ level: cfg.logLevel });
  const state = new StateStore(cfg);
  await state.load();
  const status: RuntimeStatus = {
    whatsappConnected: false,
    listenerActive: false,
    lastMessageReceivedAt: null,
    lastGitSyncAt: null,
    lastGitSyncStatus: 'never',
    startedAt: Date.now(),
    activeGroupCount: cfg.groupIds.length || cfg.groupNames.length,
    lastSafeError: null,
  };
  let client: OpenWaClient | undefined;
  let server: ReturnType<typeof startServer> | undefined;
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
    msg.attachment = await saveAttachment(cfg, client ?? {}, raw, folder);
    await writeMessage(cfg, msg, receivedDate);
    await state.add(msg.messageId);
    status.lastMessageReceivedAt = msg.receivedAt;
    log.info({ messageId: msg.messageId.slice(0, 8), type: msg.type }, 'message saved');
  };
  try {
    client = await createOpenWa(cfg);
    status.whatsappConnected = true;
    await client.onMessage(async (raw) => {
      try {
        await save(raw);
      } catch (error) {
        status.lastSafeError = (error as Error).message;
        log.error({ err: error }, 'message processing failed');
      }
    });
    status.listenerActive = true;
    log.info('WhatsApp listener active');
    if (cfg.healthEnabled) server = startServer(cfg, status);
    if (cfg.emitUnread && client.emitUnreadMessages) await client.emitUnreadMessages();
    if (cfg.gitSyncEnabled)
      setInterval(async () => {
        try {
          const result = await syncGit(cfg);
          status.lastGitSyncAt = new Date().toISOString();
          status.lastGitSyncStatus = result.status;
          log.info(result, 'git sync complete');
        } catch (error) {
          status.lastGitSyncAt = new Date().toISOString();
          status.lastGitSyncStatus = 'error';
          status.lastSafeError = (error as Error).message;
          log.error({ err: error }, 'git sync failed');
        }
      }, cfg.gitIntervalMinutes * 60_000);
  } catch (error) {
    status.lastSafeError = (error as Error).message;
    log.error({ err: error }, 'collector failed to start');
    await server?.close();
    await client?.close?.().catch(() => {});
    throw error;
  }
  const shutdown = async (code = 0) => {
    status.listenerActive = false;
    server?.close();
    await client?.close?.().catch(() => {});
    process.exit(code);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.once('uncaughtException', (error) => {
    log.fatal({ err: error }, 'uncaught exception');
    void shutdown(1);
  });
  process.once('unhandledRejection', (error) => {
    log.fatal({ err: error }, 'unhandled rejection');
    void shutdown(1);
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))
  await startCollector();

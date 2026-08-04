import express from 'express';
import type { Config } from './config.js';
import { countToday, dateFolder } from './storage.js';
export type RuntimeStatus = {
  whatsappConnected: boolean;
  listenerActive: boolean;
  lastMessageReceivedAt: string | null;
  lastGitSyncAt: string | null;
  lastGitSyncStatus: string;
  startedAt: number;
  activeGroupCount: number;
  lastSafeError: string | null;
};
export function startServer(cfg: Config, status: RuntimeStatus) {
  const app = express();
  app.get('/health', (_req, res) =>
    res.json({
      status: 'ok',
      whatsappConnected: status.whatsappConnected,
      listenerActive: status.listenerActive,
      lastMessageReceivedAt: status.lastMessageReceivedAt,
      lastGitSyncAt: status.lastGitSyncAt,
      lastGitSyncStatus: status.lastGitSyncStatus,
      uptimeSeconds: Math.floor((Date.now() - status.startedAt) / 1000),
    }),
  );
  app.get('/status', async (_req, res) =>
    res.json({
      ...status,
      uptimeSeconds: Math.floor((Date.now() - status.startedAt) / 1000),
      messagesStoredToday: await countToday(cfg),
      currentDailyFolder: await dateFolder(cfg),
    }),
  );
  return app.listen(cfg.healthPort, cfg.healthHost);
}

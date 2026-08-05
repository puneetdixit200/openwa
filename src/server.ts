import express from 'express';
import type { Server } from 'node:http';
import type { Config } from './config.js';
import { countToday, dateFolder } from './storage.js';

export type ConnectionState =
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'replaying_unread'
  | 'offline'
  | 'auth_required'
  | 'reconnecting'
  | 'stopped'
  | 'error';

export type RuntimeStatus = {
  connectionState: ConnectionState;
  whatsappConnected: boolean;
  listenerActive: boolean;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastReconnectAttemptAt: string | null;
  nextReconnectAt: string | null;
  reconnectAttempt: number;
  lastMessageReceivedAt: string | null;
  lastGitSyncAt: string | null;
  lastGitSyncStatus: string;
  lastGitSyncError: string | null;
  pendingGitFileCount: number;
  startedAt: number;
  activeGroupCount: number;
  lastSafeError: string | null;
};

function safeStatus(status: RuntimeStatus) {
  return {
    connectionState: status.connectionState,
    whatsappConnected: status.whatsappConnected,
    listenerActive: status.listenerActive,
    lastConnectedAt: status.lastConnectedAt,
    lastDisconnectedAt: status.lastDisconnectedAt,
    lastReconnectAttemptAt: status.lastReconnectAttemptAt,
    nextReconnectAt: status.nextReconnectAt,
    reconnectAttempt: status.reconnectAttempt,
    lastMessageReceivedAt: status.lastMessageReceivedAt,
    lastGitSyncAt: status.lastGitSyncAt,
    lastGitSyncStatus: status.lastGitSyncStatus,
    lastGitSyncError: status.lastGitSyncError,
    pendingGitFileCount: status.pendingGitFileCount,
    startedAt: status.startedAt,
    activeGroupCount: status.activeGroupCount,
    lastSafeError: status.lastSafeError,
  };
}

export function createApp(cfg: Config, status: RuntimeStatus) {
  const app = express();
  app.get('/health', (_req, res) =>
    res.status(200).json({
      status: 'alive',
      connectionState: status.connectionState,
      whatsappConnected: status.whatsappConnected,
      listenerActive: status.listenerActive,
      uptimeSeconds: Math.floor((Date.now() - status.startedAt) / 1000),
    }),
  );
  app.get('/ready', (_req, res) => {
    const ready = status.connectionState === 'connected' && status.listenerActive;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      connectionState: status.connectionState,
      whatsappConnected: status.whatsappConnected,
      listenerActive: status.listenerActive,
    });
  });
  app.get('/status', async (_req, res) =>
    res.json({
      ...safeStatus(status),
      uptimeSeconds: Math.floor((Date.now() - status.startedAt) / 1000),
      messagesStoredToday: await countToday(cfg),
      currentDailyFolder: await dateFolder(cfg),
    }),
  );
  return app;
}

export function startServer(cfg: Config, status: RuntimeStatus): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createApp(cfg, status).listen(cfg.healthPort, cfg.healthHost);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

export function closeServer(server: Server | undefined) {
  if (!server) return Promise.resolve();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

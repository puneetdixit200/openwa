import { describe, expect, it } from 'vitest';
import { closeServer, startServer, type RuntimeStatus } from '../src/server.js';
import type { Config } from '../src/config.js';

const cfg = { healthHost: '127.0.0.1', healthPort: 0 } as Config;
const status = (): RuntimeStatus => ({
  connectionState: 'offline',
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
  activeGroupCount: 2,
  lastSafeError: null,
  unreadReplayRunning: false,
  unreadReplayCompletedAt: null,
  inFlightMessages: 0,
  lastMessageProcessedAt: null,
  lastStorageErrorAt: null,
});

describe('health endpoints', () => {
  it('keeps health alive while disconnected and reports ready as unavailable', async () => {
    const runtime = status();
    const server = await startServer(cfg, runtime);
    const port = (server.address() as { port: number }).port;
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(503);
    runtime.connectionState = 'connected';
    runtime.whatsappConnected = true;
    runtime.listenerActive = true;
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(200);
    await closeServer(server);
  });
});

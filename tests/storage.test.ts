import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, rebuildManifest, writeMessage } from '../src/storage.js';
import type { Config } from '../src/config.js';
import type { PlacementMessage } from '../src/types.js';
const make = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwa-'));
  const data = path.join(root, 'data');
  const cfg = { dataDir: data, runtimeDir: path.join(root, 'runtime'), timezone: 'Asia/Kolkata' } as Config;
  await fs.mkdir(data, { recursive: true });
  return { root, cfg };
};
const message = (id = 'm1'): PlacementMessage => ({
  schemaVersion: 1,
  messageId: id,
  chatIdHash: '1234567890abcdef',
  groupName: 'Placement',
  senderHash: 'fedcba0987654321',
  senderDisplayName: 'Coordinator',
  timestamp: '2026-08-04T18:32:00.000Z',
  receivedAt: '2026-08-04T18:32:01.000Z',
  type: 'text',
  text: 'fake',
  caption: null,
  isForwarded: false,
  isReply: false,
  quotedMessageId: null,
  attachment: null,
  parseWarnings: [],
});
describe('durable archive', () => {
  it('reconciles IDs from existing JSONL on restart', async () => {
    const { cfg } = await make();
    await writeMessage(cfg, message());
    const state = new StateStore(cfg);
    await state.load();
    expect(state.has('m1')).toBe(true);
  });
  it('repairs a manifest without changing messages', async () => {
    const { cfg } = await make();
    await writeMessage(cfg, message());
    const day = '2026-08-05';
    const source = path.join(cfg.dataDir, '2026-08-05');
    await fs.mkdir(source, { recursive: true });
    await fs
      .copyFile(path.join(cfg.dataDir, '2026-08-05', 'messages.jsonl'), path.join(source, 'messages.jsonl'))
      .catch(async () => {
        await writeMessage(cfg, message('m2'), new Date('2026-08-05T00:00:00+05:30'));
      });
    const actual = path.join(cfg.dataDir, day);
    const before = await fs.readFile(path.join(actual, 'messages.jsonl'), 'utf8');
    const manifest = await rebuildManifest(cfg, day);
    expect(manifest.messageCount).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(actual, 'messages.jsonl'), 'utf8')).toBe(before);
  });
});

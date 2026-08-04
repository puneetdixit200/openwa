import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import type { PlacementMessage } from './types.js';
import { placementMessageSchema } from './types.js';
import { appendLine, atomicWrite, ensureDirs, isoInZone, sha256 } from './utils.js';
type Manifest = {
  schemaVersion: 1;
  date: string;
  timezone: string;
  createdAt: string;
  updatedAt?: string;
  messageCount: number;
  attachmentCount: number;
  failedAttachmentCount: number;
  messageTypes: Record<string, number>;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  files: Array<{ path: string; sha256: string }>;
};
export class StateStore {
  private ids = new Set<string>();
  private file: string;
  constructor(private cfg: Config) {
    this.file = path.join(cfg.runtimeDir, 'processed-message-ids.json');
  }
  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (Array.isArray(parsed)) this.ids = new Set(parsed.filter((x): x is string => typeof x === 'string'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const discovered = await discoverMessageIds(this.cfg.dataDir);
    for (const id of discovered) this.ids.add(id);
    await this.persist();
  }
  has(id: string) {
    return this.ids.has(id);
  }
  async add(id: string) {
    this.ids.add(id);
    await this.persist();
  }
  private async persist() {
    await atomicWrite(this.file, JSON.stringify([...this.ids].sort(), null, 2) + '\n');
  }
}
async function discoverMessageIds(root: string): Promise<string[]> {
  const ids: string[] = [];
  let days: string[] = [];
  try {
    days = await fs.readdir(root);
  } catch {
    return ids;
  }
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    try {
      const lines = (await fs.readFile(path.join(root, day, 'messages.jsonl'), 'utf8')).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { messageId?: unknown };
          if (typeof parsed.messageId === 'string') ids.push(parsed.messageId);
        } catch {
          /* validation command reports malformed lines */
        }
      }
    } catch {
      /* missing daily archive is harmless */
    }
  }
  return ids;
}
export async function dateFolder(cfg: Config, date = new Date()) {
  return path.join(cfg.dataDir, isoInZone(date, cfg.timezone).date);
}
export async function writeMessage(cfg: Config, msg: PlacementMessage, date = new Date()) {
  placementMessageSchema.parse(msg);
  const folder = await dateFolder(cfg, date);
  await ensureDirs(path.join(folder, 'attachments'));
  await appendLine(path.join(folder, 'messages.jsonl'), JSON.stringify(msg) + '\n');
  await updateManifest(cfg, msg, folder);
}
export async function recordFailure(folder: string, data: unknown) {
  await fs.mkdir(folder, { recursive: true });
  await appendLine(path.join(folder, 'failed-downloads.jsonl'), JSON.stringify(data) + '\n');
}
export async function readDay(cfg: Config, day: string) {
  const folder = path.join(cfg.dataDir, day);
  const lines = (await fs.readFile(path.join(folder, 'messages.jsonl'), 'utf8')).split('\n').filter(Boolean);
  const messages = lines.map((line, index) => {
    try {
      return placementMessageSchema.parse(JSON.parse(line));
    } catch (e) {
      throw new Error(`invalid messages.jsonl line ${index + 1}: ${(e as Error).message}`);
    }
  });
  return { folder, messages };
}
export async function rebuildManifest(cfg: Config, day: string) {
  const { folder, messages } = await readDay(cfg, day);
  let old: string | undefined;
  try {
    old = await fs.readFile(path.join(folder, 'manifest.json'), 'utf8');
    await fs.copyFile(path.join(folder, 'manifest.json'), path.join(folder, 'manifest.json.bak'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const types: Record<string, number> = {};
  let attachmentCount = 0,
    failedAttachmentCount = 0;
  for (const msg of messages) {
    types[msg.type] = (types[msg.type] ?? 0) + 1;
    if (msg.attachment) {
      attachmentCount++;
      if (msg.attachment.status === 'failed') failedAttachmentCount++;
    }
  }
  const now = new Date().toISOString();
  let createdAt = now;
  if (old) {
    try {
      createdAt = (JSON.parse(old) as { createdAt?: string }).createdAt ?? now;
    } catch {
      /* corrupted manifest is replaced below */
    }
  }
  const manifest = {
    schemaVersion: 1,
    date: day,
    timezone: cfg.timezone,
    createdAt,
    updatedAt: now,
    messageCount: messages.length,
    attachmentCount,
    failedAttachmentCount,
    messageTypes: types,
    firstMessageAt: messages[0]?.timestamp ?? null,
    lastMessageAt: messages.at(-1)?.timestamp ?? null,
    files: await checksums(folder),
  };
  await atomicWrite(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
async function checksums(folder: string) {
  const files: string[] = [];
  for (const name of ['messages.jsonl', 'failed-downloads.jsonl']) {
    try {
      const b = await fs.readFile(path.join(folder, name));
      files.push(JSON.stringify({ path: name, sha256: sha256(b) }));
    } catch {}
  }
  return files.map((x) => JSON.parse(x));
}
async function updateManifest(cfg: Config, msg: PlacementMessage, folder: string) {
  let existing: Manifest;
  try {
    existing = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    existing = {
      schemaVersion: 1,
      date: path.basename(folder),
      timezone: cfg.timezone,
      createdAt: msg.receivedAt,
      messageCount: 0,
      attachmentCount: 0,
      failedAttachmentCount: 0,
      messageTypes: {},
      firstMessageAt: null,
      lastMessageAt: null,
      files: [],
    };
  }
  existing.messageCount++;
  existing.messageTypes[msg.type] = (existing.messageTypes[msg.type] ?? 0) + 1;
  if (msg.attachment) {
    existing.attachmentCount++;
    if (msg.attachment.status === 'failed') existing.failedAttachmentCount++;
  }
  existing.firstMessageAt ??= msg.timestamp;
  existing.lastMessageAt = msg.timestamp;
  existing.updatedAt = msg.receivedAt;
  existing.files = await checksums(folder);
  await atomicWrite(path.join(folder, 'manifest.json'), JSON.stringify(existing, null, 2) + '\n');
}
export async function countToday(cfg: Config) {
  try {
    return (await readDay(cfg, isoInZone(new Date(), cfg.timezone).date)).messages.length;
  } catch {
    return 0;
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import type { Attachment } from './types.js';
import { atomicWrite, safeFilename, sha256 } from './utils.js';
import { recordFailure } from './storage.js';
type MediaClient = { decryptMedia?: (message: unknown) => Promise<string> };
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function saveAttachment(
  cfg: Config,
  client: MediaClient,
  raw: Record<string, unknown>,
  folder: string,
): Promise<Attachment | null> {
  if (!raw.isMedia) return null;
  await fs.mkdir(path.join(folder, 'attachments'), { recursive: true });
  const original = String(
    raw.filename ??
      `attachment.${
        String(raw.mimetype ?? 'bin')
          .split('/')
          .at(-1) ?? 'bin'
      }`,
  );
  const base: Attachment = {
    status: 'failed',
    originalFileName: original,
    mimeType: typeof raw.mimetype === 'string' ? raw.mimetype : undefined,
  };
  let lastError = 'attachment download failed';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (!cfg.downloadAttachments) return { ...base, status: 'skipped' };
      if (!client.decryptMedia) throw new Error('WhatsApp media download is unavailable');
      const dataUrl = await client.decryptMedia(raw);
      const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/s);
      if (!match) throw new Error('WhatsApp client returned invalid media data');
      const bytes = Buffer.from(match[1], 'base64');
      if (bytes.byteLength > cfg.maxAttachmentBytes) throw new Error('attachment exceeds configured size limit');
      const when = new Date(Number(raw.timestamp ?? Date.now()) * (Number(raw.timestamp) < 1e12 ? 1000 : 1));
      const initial = safeFilename(original, when, String(raw.id ?? raw.messageId ?? 'message'));
      const extension = path.extname(initial);
      const stem = initial.slice(0, -extension.length);
      let stored = initial;
      let suffix = 1;
      while (await exists(path.join(folder, 'attachments', stored))) stored = `${stem}-${suffix++}${extension}`;
      await atomicWrite(path.join(folder, 'attachments', stored), bytes);
      return {
        ...base,
        status: 'downloaded',
        storedFileName: stored,
        relativePath: `attachments/${stored}`,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      };
    } catch (error) {
      lastError = (error as Error).message.replace(/[\r\n]/g, ' ').slice(0, 180);
      if (attempt < 3) await wait(100 * 2 ** (attempt - 1));
    }
  }
  await recordFailure(folder, {
    messageId: String(raw.id ?? raw.messageId ?? 'unknown'),
    error: lastError,
    attempts: 3,
    recordedAt: new Date().toISOString(),
  });
  return { ...base, error: lastError };
}
async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

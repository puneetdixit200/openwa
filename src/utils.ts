import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function atomicWrite(file: string, data: string | Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const h = await fs.open(tmp, 'w');
  try {
    await h.writeFile(data);
    await h.sync();
  } finally {
    await h.close();
  }
  await fs.rename(tmp, file);
}
export async function appendLine(file: string, line: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'a');
  try {
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export function sha256(data: Buffer | string) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
export function saltedHash(salt: string, value: string) {
  return sha256(`${salt}:${value}`).slice(0, 16);
}
export function safeErrorMessage(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/[^\s/]+@/gi, 'https://[redacted]@')
    .replace(/\b\d{7,}\b/g, '[redacted]');
}
export function redactPhoneNumbers(value: string | null) {
  return value?.replace(/(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g, '[phone redacted]') ?? null;
}
export function safeFilename(original: string, time: Date, messageId: string) {
  const ext = path
    .extname(original)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
    .slice(0, 10);
  const base = path
    .basename(original, path.extname(original))
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, sixty());
  const hhmmss = time.toISOString().slice(11, 19).replaceAll(':', '');
  return `${hhmmss}_${base || 'attachment'}_${messageId.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}${ext}`;
}
function sixty() {
  return 60;
}
export function isoInZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, iso: date.toISOString() };
}
export async function ensureDirs(...dirs: string[]) {
  await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })));
}

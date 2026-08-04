import 'dotenv/config';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const bool = z.preprocess((v) => (v === undefined ? undefined : String(v).toLowerCase() === 'true'), z.boolean());
const list = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
  z.array(z.string()),
);
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TIMEZONE: z.string().default('Asia/Kolkata'),
  OPENWA_SESSION_ID: z.string().default('placement-listener'),
  OPENWA_HEADLESS: bool.default(false),
  OPENWA_QR_TIMEOUT: z.coerce.number().int().nonnegative().default(0),
  OPENWA_AUTH_TIMEOUT: z.coerce.number().int().nonnegative().default(0),
  OPENWA_BROWSER_PATH: z
    .string()
    .default('')
    .refine((value) => !value || existsSync(value), {
      message: 'OPENWA_BROWSER_PATH does not exist; remove it to use bundled Chromium or set the exact executable path',
    }),
  OPENWA_CUSTOM_USER_AGENT: z
    .string()
    .default('')
    .refine((value) => !value || value.length >= 20, {
      message: 'OPENWA_CUSTOM_USER_AGENT must be at least 20 characters when configured',
    }),
  OPENWA_SESSION_DIRECTORY: z.string().default('./.local-session'),
  ALLOWED_GROUP_IDS: list.default([]),
  ALLOWED_GROUP_NAMES: list.default([]),
  DATA_REPOSITORY_PATH: z.string().default('./placement-data'),
  DATA_DIRECTORY: z.string(),
  RUNTIME_DIRECTORY: z.string().default('./runtime'),
  LOG_DIRECTORY: z.string().default('./logs'),
  HASH_SALT: z.string().min(32, 'HASH_SALT must be at least 32 characters'),
  DOWNLOAD_ATTACHMENTS: bool.default(true),
  MAX_ATTACHMENT_SIZE_MB: z.coerce.number().int().positive().max(1024).default(25),
  GIT_SYNC_ENABLED: bool.default(false),
  GIT_REMOTE: z.string().default('origin'),
  GIT_BRANCH: z.string().default('main'),
  GIT_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  GIT_COMMIT_AUTHOR_NAME: z.string().default('Placement Collector'),
  GIT_COMMIT_AUTHOR_EMAIL: z.string().email().default('collector@example.com'),
  HEALTH_SERVER_ENABLED: bool.default(true),
  HEALTH_SERVER_HOST: z.string().default('127.0.0.1'),
  HEALTH_SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  EMIT_UNREAD_MESSAGES_ON_START: bool.default(true),
  MESSAGE_TEXT_PRIVACY_MODE: z.enum(['preserve', 'redact-phone-numbers']).default('preserve'),
  PRESERVE_DISPLAY_NAMES: bool.default(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export type Config = {
  nodeEnv: string;
  timezone: string;
  sessionId: string;
  headless: boolean;
  qrTimeout: number;
  authTimeout: number;
  browserPath?: string;
  customUserAgent?: string;
  sessionDirectory: string;
  groupIds: string[];
  groupNames: string[];
  dataRepoPath: string;
  dataDir: string;
  runtimeDir: string;
  logDir: string;
  codeRepoPath: string;
  hashSalt: string;
  downloadAttachments: boolean;
  maxAttachmentBytes: number;
  gitSyncEnabled: boolean;
  gitBranch: string;
  gitRemote: string;
  gitIntervalMinutes: number;
  gitAuthorName: string;
  gitAuthorEmail: string;
  healthEnabled: boolean;
  healthHost: string;
  healthPort: number;
  emitUnread: boolean;
  textPrivacy: 'preserve' | 'redact-phone-numbers';
  preserveDisplayNames: boolean;
  logLevel: string;
};
export function loadConfig(cwd = process.cwd(), requireGroups = true): Config {
  const v = schema.parse(process.env);
  const codeRepoPath = path.resolve(cwd);
  const dataRepoPath = path.resolve(cwd, v.DATA_REPOSITORY_PATH);
  const dataDir = path.resolve(cwd, v.DATA_DIRECTORY);
  const inside = dataDir.startsWith(`${dataRepoPath}${path.sep}`);
  if (!inside) throw new Error('DATA_DIRECTORY must be inside DATA_REPOSITORY_PATH');
  for (const [name, value] of [
    ['OPENWA_SESSION_DIRECTORY', v.OPENWA_SESSION_DIRECTORY],
    ['RUNTIME_DIRECTORY', v.RUNTIME_DIRECTORY],
    ['LOG_DIRECTORY', v.LOG_DIRECTORY],
  ] as const) {
    const resolved = path.resolve(cwd, value);
    if (dataDir === resolved || dataDir.startsWith(`${resolved}${path.sep}`))
      throw new Error(`DATA_DIRECTORY must not be inside ${name}`);
  }
  if (dataRepoPath === codeRepoPath || dataRepoPath.startsWith(`${codeRepoPath}${path.sep}`))
    throw new Error('DATA_REPOSITORY_PATH must be a separate repository outside the code repository');
  if (requireGroups && !v.ALLOWED_GROUP_IDS.length && !v.ALLOWED_GROUP_NAMES.length)
    throw new Error('configure ALLOWED_GROUP_IDS or ALLOWED_GROUP_NAMES before starting the collector');
  return {
    nodeEnv: v.NODE_ENV,
    timezone: v.TIMEZONE,
    sessionId: v.OPENWA_SESSION_ID,
    headless: v.OPENWA_HEADLESS,
    qrTimeout: v.OPENWA_QR_TIMEOUT,
    authTimeout: v.OPENWA_AUTH_TIMEOUT,
    browserPath: v.OPENWA_BROWSER_PATH,
    customUserAgent: v.OPENWA_CUSTOM_USER_AGENT,
    sessionDirectory: path.resolve(cwd, v.OPENWA_SESSION_DIRECTORY),
    groupIds: v.ALLOWED_GROUP_IDS,
    groupNames: v.ALLOWED_GROUP_NAMES,
    dataRepoPath,
    dataDir,
    runtimeDir: path.resolve(cwd, v.RUNTIME_DIRECTORY),
    logDir: path.resolve(cwd, v.LOG_DIRECTORY),
    codeRepoPath,
    hashSalt: v.HASH_SALT,
    downloadAttachments: v.DOWNLOAD_ATTACHMENTS,
    maxAttachmentBytes: v.MAX_ATTACHMENT_SIZE_MB * 1024 * 1024,
    gitSyncEnabled: v.GIT_SYNC_ENABLED,
    gitBranch: v.GIT_BRANCH,
    gitRemote: v.GIT_REMOTE,
    gitIntervalMinutes: v.GIT_SYNC_INTERVAL_MINUTES,
    gitAuthorName: v.GIT_COMMIT_AUTHOR_NAME,
    gitAuthorEmail: v.GIT_COMMIT_AUTHOR_EMAIL,
    healthEnabled: v.HEALTH_SERVER_ENABLED,
    healthHost: v.HEALTH_SERVER_HOST,
    healthPort: v.HEALTH_SERVER_PORT,
    emitUnread: v.EMIT_UNREAD_MESSAGES_ON_START,
    textPrivacy: v.MESSAGE_TEXT_PRIVACY_MODE,
    preserveDisplayNames: v.PRESERVE_DISPLAY_NAMES,
    logLevel: v.LOG_LEVEL,
  };
}
export async function prepareLocalDirectories(cfg: Config) {
  await Promise.all([
    fs.mkdir(cfg.runtimeDir, { recursive: true }),
    fs.mkdir(cfg.logDir, { recursive: true }),
    fs.mkdir(cfg.sessionDirectory, { recursive: true }),
    fs.mkdir(path.join(cfg.runtimeDir, 'locks'), { recursive: true }),
  ]);
}
export function envLine(name: string, value: string) {
  return new RegExp(`^${name}=.*$`, 'm').test(value) ? value : `${value.trimEnd()}\n${name}=`;
}

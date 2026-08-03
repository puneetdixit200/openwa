import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const bool = z.preprocess((v) => String(v).toLowerCase() === 'true', z.boolean());
const list = z.preprocess((v) => typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [], z.array(z.string()));
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'), TIMEZONE: z.string().default('Asia/Kolkata'),
  OPENWA_SESSION_ID: z.string().default('placement-listener'), OPENWA_HEADLESS: bool.default(true), ALLOWED_GROUP_IDS: list,
  ALLOWED_GROUP_NAMES: list, DATA_DIRECTORY: z.string().default('./incoming'), RUNTIME_DIRECTORY: z.string().default('./runtime'), LOG_DIRECTORY: z.string().default('./logs'),
  HASH_SALT: z.string().min(16, 'HASH_SALT must be at least 16 characters'), DOWNLOAD_ATTACHMENTS: bool.default(true),
  MAX_ATTACHMENT_SIZE_MB: z.coerce.number().int().positive().max(1024).default(25), GIT_SYNC_ENABLED: bool.default(true), GIT_BRANCH: z.string().default('main'), GIT_REMOTE: z.string().default('origin'),
  GIT_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15), GIT_COMMIT_AUTHOR_NAME: z.string().default('Placement Collector'), GIT_COMMIT_AUTHOR_EMAIL: z.string().email().default('collector@example.com'),
  HEALTH_SERVER_ENABLED: bool.default(true), HEALTH_SERVER_HOST: z.string().default('127.0.0.1'), HEALTH_SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3100), EMIT_UNREAD_MESSAGES_ON_START: bool.default(true),
  MESSAGE_TEXT_PRIVACY_MODE: z.enum(['preserve', 'redact-phone-numbers']).default('preserve'), PRESERVE_DISPLAY_NAMES: bool.default(true), LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info')
}).superRefine((v, ctx) => { if (!v.ALLOWED_GROUP_IDS.length && !v.ALLOWED_GROUP_NAMES.length) ctx.addIssue({ code: 'custom', path: ['ALLOWED_GROUP_IDS'], message: 'configure at least one allowed group ID or name' }); });
export type Config = { nodeEnv:string; timezone:string; sessionId:string; headless:boolean; groupIds:string[]; groupNames:string[]; dataDir:string; runtimeDir:string; logDir:string; hashSalt:string; downloadAttachments:boolean; maxAttachmentBytes:number; gitSyncEnabled:boolean; gitBranch:string; gitRemote:string; gitIntervalMinutes:number; gitAuthorName:string; gitAuthorEmail:string; healthEnabled:boolean; healthHost:string; healthPort:number; emitUnread:boolean; textPrivacy:'preserve'|'redact-phone-numbers'; preserveDisplayNames:boolean; logLevel:string };
export function loadConfig(cwd = process.cwd()): Config { const v = schema.parse(process.env); return { nodeEnv:v.NODE_ENV, timezone:v.TIMEZONE, sessionId:v.OPENWA_SESSION_ID, headless:v.OPENWA_HEADLESS, groupIds:v.ALLOWED_GROUP_IDS, groupNames:v.ALLOWED_GROUP_NAMES, dataDir:path.resolve(cwd,v.DATA_DIRECTORY), runtimeDir:path.resolve(cwd,v.RUNTIME_DIRECTORY), logDir:path.resolve(cwd,v.LOG_DIRECTORY), hashSalt:v.HASH_SALT, downloadAttachments:v.DOWNLOAD_ATTACHMENTS, maxAttachmentBytes:v.MAX_ATTACHMENT_SIZE_MB*1024*1024, gitSyncEnabled:v.GIT_SYNC_ENABLED, gitBranch:v.GIT_BRANCH, gitRemote:v.GIT_REMOTE, gitIntervalMinutes:v.GIT_SYNC_INTERVAL_MINUTES, gitAuthorName:v.GIT_COMMIT_AUTHOR_NAME, gitAuthorEmail:v.GIT_COMMIT_AUTHOR_EMAIL, healthEnabled:v.HEALTH_SERVER_ENABLED, healthHost:v.HEALTH_SERVER_HOST, healthPort:v.HEALTH_SERVER_PORT, emitUnread:v.EMIT_UNREAD_MESSAGES_ON_START, textPrivacy:v.MESSAGE_TEXT_PRIVACY_MODE, preserveDisplayNames:v.PRESERVE_DISPLAY_NAMES, logLevel:v.LOG_LEVEL }; }

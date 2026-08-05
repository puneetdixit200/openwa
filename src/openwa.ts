import type { Config } from './config.js';
import type { MessageType, PlacementMessage } from './types.js';
import { redactPhoneNumbers, saltedHash } from './utils.js';
export type IncomingMessage = {
  id?: string;
  messageId?: string;
  chatId?: string;
  from?: string;
  to?: string;
  body?: string;
  text?: string;
  type?: string;
  timestamp?: number | string;
  fromMe?: boolean;
  self?: string;
  isNotification?: boolean;
  isGroupMsg?: boolean;
  isMedia?: boolean;
  mimetype?: string;
  filename?: string;
  caption?: string;
  isForwarded?: boolean;
  quotedMsgId?: string;
  sender?: { id?: string; pushname?: string; formattedName?: string };
  chat?: { id?: string; name?: string };
  [key: string]: unknown;
};
export type GroupSummary = { id: string; name: string; isGroup?: boolean };
export type OpenWaClient = {
  onMessage: (cb: (m: IncomingMessage) => Promise<void>) => Promise<void> | void;
  getAllGroups?: (includeComms?: boolean) => Promise<GroupSummary[]>;
  getAllChats?: () => Promise<GroupSummary[]>;
  emitUnreadMessages?: () => Promise<unknown>;
  decryptMedia?: (message: unknown) => Promise<string>;
  close?: () => Promise<void>;
  isConnected?: () => Promise<boolean> | boolean;
  onStateChanged?: (cb: (state: string) => void) => Promise<void> | void;
};
export function chatIdOf(m: IncomingMessage) {
  return String(m.chatId ?? m.chat?.id ?? m.from ?? '');
}
export function groupNameOf(m: IncomingMessage) {
  return String(m.chat?.name ?? '');
}
export function allowedMessage(m: IncomingMessage, cfg: Config) {
  const id = chatIdOf(m);
  if (!id.endsWith('@g.us')) return false;
  if (cfg.groupIds.length) return cfg.groupIds.includes(id);
  return cfg.groupNames.includes(groupNameOf(m));
}
export function shouldIgnoreMessage(m: IncomingMessage) {
  return Boolean(
    m.fromMe ||
    m.self === 'out' ||
    m.isNotification ||
    m.isGroupMsg === false ||
    (m.from && !String(m.from).endsWith('@g.us')),
  );
}
export function normalise(m: IncomingMessage, cfg: Config): PlacementMessage {
  const warnings: string[] = [];
  const id = String(m.id ?? m.messageId ?? `${m.timestamp}-${chatIdOf(m)}`);
  const sender = String((m.sender?.id ?? m.author ?? '') as string);
  const group = groupNameOf(m);
  if (!group) warnings.push('Missing group name');
  const rawText = typeof m.body === 'string' ? m.body : typeof m.text === 'string' ? m.text : null;
  const rawType = String(m.type ?? (m.isMedia ? 'document' : 'text'));
  const typeMap: Record<string, MessageType> = {
    chat: 'text',
    text: 'text',
    image: 'image',
    document: 'document',
    video: 'video',
    audio: 'audio',
    ptt: 'audio',
    sticker: 'sticker',
    link: 'link',
  };
  const type = typeMap[rawType] ?? 'unknown';
  if (!typeMap[rawType]) warnings.push(`Unsupported WhatsApp message type: ${rawType}`);
  return {
    schemaVersion: 1,
    messageId: id,
    chatIdHash: saltedHash(cfg.hashSalt, chatIdOf(m)),
    groupName: group || null,
    senderHash: sender ? saltedHash(cfg.hashSalt, sender) : null,
    senderDisplayName: cfg.preserveDisplayNames
      ? redactPhoneNumbers(m.sender?.pushname ?? m.sender?.formattedName ?? null)
      : null,
    timestamp: new Date(Number(m.timestamp ?? Date.now()) * (Number(m.timestamp) < 1e12 ? 1000 : 1)).toISOString(),
    receivedAt: new Date().toISOString(),
    type,
    text: cfg.textPrivacy === 'redact-phone-numbers' ? redactPhoneNumbers(rawText) : rawText,
    caption: m.caption ?? null,
    isForwarded: Boolean(m.isForwarded),
    isReply: Boolean(m.quotedMsgId),
    quotedMessageId: m.quotedMsgId ?? null,
    attachment: null,
    parseWarnings: warnings,
  };
}
export type OpenWaLaunchOptions = { interactive?: boolean };

export function isAuthRequiredError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /logged\s*out|not\s+authenticated|authentication\s+required|session\s+(?:expired|invalid|not\s+found)|unpaired|needs?\s+(?:qr|scan)|qr\s+code/i.test(
    message,
  );
}

export async function createOpenWa(cfg: Config, options: OpenWaLaunchOptions = {}): Promise<OpenWaClient> {
  const mod = await import('@open-wa/wa-automate');
  const interactive = options.interactive === true;
  const backgroundExistingSession = !interactive && cfg.backgroundAuthMode === 'existing-session-only';
  const client = await mod.create({
    sessionId: cfg.sessionId,
    headless: interactive ? false : cfg.headless,
    cacheEnabled: true,
    sessionDataPath: cfg.sessionDirectory,
    useChrome: false,
    qrTimeout: backgroundExistingSession ? 1 : cfg.qrTimeout,
    authTimeout: backgroundExistingSession ? 1 : cfg.authTimeout,
    ...(backgroundExistingSession ? { throwOnExpiredSessionData: true, killProcessOnTimeout: false } : {}),
    // OpenWA 4.76.0 only forwards customUserAgent through its inDocker path.
    // Enable that path only when an explicit compatible UA is configured.
    ...(cfg.customUserAgent ? { inDocker: true, customUserAgent: cfg.customUserAgent } : {}),
    ...(cfg.browserPath
      ? {
          executablePath: cfg.browserPath,
        }
      : {}),
  });
  return client as unknown as OpenWaClient;
}

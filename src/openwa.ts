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
  getAllChats?: () => Promise<GroupSummary[]>;
  emitUnreadMessages?: () => Promise<unknown>;
  decryptMedia?: (message: unknown) => Promise<string>;
  close?: () => Promise<void>;
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
    type: (m.type ?? (m.isMedia ? 'document' : 'text')) as MessageType,
    text: cfg.textPrivacy === 'redact-phone-numbers' ? redactPhoneNumbers(rawText) : rawText,
    caption: m.caption ?? null,
    isForwarded: Boolean(m.isForwarded),
    isReply: Boolean(m.quotedMsgId),
    quotedMessageId: m.quotedMsgId ?? null,
    attachment: null,
    parseWarnings: warnings,
  };
}
export async function createOpenWa(cfg: Config): Promise<OpenWaClient> {
  const mod = await import('@open-wa/wa-automate');
  const client = await mod.create({
    sessionId: cfg.sessionId,
    headless: cfg.headless,
    cacheEnabled: true,
    sessionDataPath: cfg.sessionDirectory,
    useChrome: true,
    qrTimeout: 0,
    authTimeout: 0,
  });
  return client as unknown as OpenWaClient;
}

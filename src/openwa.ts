import path from 'node:path';
import fs from 'node:fs/promises';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
} from '@whiskeysockets/baileys';
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
  __nativeMessage?: WAMessage;
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

export type OpenWaLaunchOptions = { interactive?: boolean; allowQr?: boolean };

function errorStatusCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { output?: { statusCode?: unknown }; statusCode?: unknown };
  const status = candidate.output?.statusCode ?? candidate.statusCode;
  return typeof status === 'number' ? status : undefined;
}

function isRestartRequiredError(error: unknown) {
  return errorStatusCode(error) === DisconnectReason.restartRequired || /restart required/i.test(String(error));
}

export function isAuthRequiredError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = errorStatusCode(error);
  return (
    status === DisconnectReason.loggedOut ||
    status === DisconnectReason.badSession ||
    /logged\s*out|not\s+authenticated|authentication\s+required|session\s+(?:expired|invalid|not\s+found)|unpaired|needs?\s+(?:qr|scan)|bad\s+session/i.test(
      message,
    )
  );
}

function contentOf(message: WAMessage) {
  let content = message.message;
  while (content?.ephemeralMessage?.message || content?.viewOnceMessage?.message || content?.viewOnceMessageV2?.message)
    content =
      content.ephemeralMessage?.message ?? content.viewOnceMessage?.message ?? content.viewOnceMessageV2?.message;
  return content ?? {};
}

function messageDetails(message: WAMessage) {
  const content = contentOf(message);
  const image = content.imageMessage;
  const document = content.documentMessage;
  const video = content.videoMessage;
  const audio = content.audioMessage;
  const sticker = content.stickerMessage;
  const media = image ?? document ?? video ?? audio ?? sticker;
  const context = content.extendedTextMessage?.contextInfo ?? media?.contextInfo;
  const caption = image?.caption ?? document?.caption ?? video?.caption;
  const type = image
    ? 'image'
    : document
      ? 'document'
      : video
        ? 'video'
        : audio
          ? audio.ptt
            ? 'ptt'
            : 'audio'
          : sticker
            ? 'sticker'
            : content.extendedTextMessage?.matchedText
              ? 'link'
              : content.conversation || content.extendedTextMessage?.text
                ? 'chat'
                : 'unknown';
  return {
    type,
    body: content.conversation ?? content.extendedTextMessage?.text ?? caption,
    caption,
    isMedia: Boolean(media),
    mimetype: media?.mimetype,
    filename: document?.fileName,
    isForwarded: Boolean(context?.isForwarded),
    quotedMsgId: context?.stanzaId,
  };
}

export function toIncomingMessage(message: WAMessage, groupNames: Map<string, string>): IncomingMessage | null {
  const chatId = message.key.remoteJid;
  const id = message.key.id;
  if (!chatId || !id) return null;
  const details = messageDetails(message);
  return {
    id,
    messageId: id,
    chatId,
    from: chatId,
    to: message.key.remoteJid ?? undefined,
    body: details.body ?? undefined,
    type: details.type,
    timestamp: Number(message.messageTimestamp ?? Date.now() / 1000),
    fromMe: Boolean(message.key.fromMe),
    isNotification: message.messageStubType !== undefined || !message.message,
    isGroupMsg: chatId.endsWith('@g.us'),
    isMedia: details.isMedia,
    mimetype: details.mimetype ?? undefined,
    filename: details.filename ?? undefined,
    caption: details.caption ?? undefined,
    isForwarded: details.isForwarded,
    quotedMsgId: details.quotedMsgId ?? undefined,
    sender: { id: message.key.participant ?? chatId, pushname: message.pushName ?? undefined },
    chat: { id: chatId, name: groupNames.get(chatId) },
    __nativeMessage: message,
  };
}

function safeBaileysLogger() {
  return pino({ level: 'silent' });
}

async function secureAuthDirectory(directory: string) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    await fs.chmod(target, entry.isDirectory() ? 0o700 : 0o600);
  }
}

export function baileysAuthDirectory(cfg: Config) {
  return path.join(cfg.sessionDirectory, `baileys-${cfg.sessionId}`);
}

/**
 * Keep an unusable pairing attempt for diagnosis while making a clean QR
 * pairing possible. This is intentionally limited to Baileys' own new
 * credential directory; it never touches an older browser profile.
 */
export async function quarantineBaileysAuthState(cfg: Config) {
  const directory = baileysAuthDirectory(cfg);
  const backup = `${directory}.invalid-${Date.now()}`;
  try {
    await fs.rename(directory, backup);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function createOpenWa(cfg: Config, options: OpenWaLaunchOptions = {}): Promise<OpenWaClient> {
  // WhatsApp can explicitly require one fresh socket immediately after the
  // initial handshake. It is a protocol transition, not an auth failure.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await createBaileysClient(cfg, options);
    } catch (error) {
      if (!isRestartRequiredError(error) || attempt === 2) throw error;
    }
  }
  throw new Error('WhatsApp connection restart limit reached');
}

async function createBaileysClient(cfg: Config, options: OpenWaLaunchOptions): Promise<OpenWaClient> {
  const interactive = options.interactive === true;
  const allowQr = options.allowQr === true;
  const authDirectory = baileysAuthDirectory(cfg);
  await secureAuthDirectory(authDirectory);
  const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
  // WhatsApp's version endpoint is an optimisation, not a prerequisite for
  // pairing. Bound it so DNS/network trouble cannot prevent a local QR from
  // ever appearing; Baileys returns its bundled stable version on failure.
  const versionAbort = new AbortController();
  const versionTimeout = setTimeout(() => versionAbort.abort(), 10_000);
  const { version } = await fetchLatestBaileysVersion({ signal: versionAbort.signal }).finally(() =>
    clearTimeout(versionTimeout),
  );
  const socket = makeWASocket({
    auth: state,
    version,
    browser: Browsers.ubuntu('Placement Collector'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    logger: safeBaileysLogger(),
  });
  const groupNames = new Map<string, string>();
  const messageCallbacks = new Set<(message: IncomingMessage) => Promise<void>>();
  const queued: IncomingMessage[] = [];
  const inFlight = new Set<Promise<void>>();
  let connected = false;
  let closed = false;
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const dispatch = (message: IncomingMessage) => {
    if (!messageCallbacks.size) {
      queued.push(message);
      return;
    }
    for (const callback of messageCallbacks) {
      const task = Promise.resolve(callback(message)).catch(() => {});
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    }
  };
  const refreshGroups = async () => {
    const groups = await socket.groupFetchAllParticipating();
    for (const [id, group] of Object.entries(groups)) groupNames.set(id, group.subject || '(unnamed)');
    return [...groupNames.entries()].map(([id, name]) => ({ id, name, isGroup: true }));
  };

  socket.ev.on('creds.update', () => {
    void saveCreds().then(() => secureAuthDirectory(authDirectory));
  });
  socket.ev.on('messages.upsert', ({ messages }) => {
    for (const native of messages) {
      const message = toIncomingMessage(native, groupNames);
      if (message) dispatch(message);
    }
  });
  socket.ev.on('connection.update', (update) => {
    if (update.qr) {
      if (interactive && allowQr) {
        console.log('Scan the WhatsApp QR code shown below in this terminal.');
        qrcode.generate(update.qr, { small: true });
      } else {
        rejectReady(new Error('WhatsApp authentication required; run npm run auth'));
        socket.end(new Error('authentication required'));
      }
    }
    if (update.connection === 'open') {
      connected = true;
      void refreshGroups().catch(() => {});
      resolveReady();
    }
    if (update.connection === 'close') {
      connected = false;
      if (!closed) {
        const error = update.lastDisconnect?.error;
        rejectReady(error instanceof Error ? error : new Error('WhatsApp connection closed'));
      }
    }
  });

  // Background collection and group commands must never wait forever for a QR
  // that they are deliberately not allowed to display. Interactive auth keeps
  // the requested indefinite QR wait.
  if (interactive && allowQr) await ready;
  else {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        ready,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('WhatsApp connection timed out after 60 seconds')), 60_000);
        }),
      ]);
    } catch (error) {
      closed = true;
      socket.end(error instanceof Error ? error : new Error('WhatsApp connection failed'));
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  return {
    onMessage: async (callback) => {
      messageCallbacks.add(callback);
      while (queued.length) {
        const message = queued.shift();
        if (message) dispatch(message);
      }
    },
    getAllGroups: async () => refreshGroups(),
    getAllChats: async () => refreshGroups(),
    emitUnreadMessages: async () => {
      await Promise.allSettled([...inFlight]);
    },
    decryptMedia: async (raw) => {
      const native = (raw as IncomingMessage).__nativeMessage;
      if (!native) throw new Error('WhatsApp media source is unavailable');
      const bytes = await downloadMediaMessage(
        native,
        'buffer',
        {},
        { logger: safeBaileysLogger(), reuploadRequest: socket.updateMediaMessage },
      );
      const mimetype = messageDetails(native).mimetype || 'application/octet-stream';
      return `data:${mimetype};base64,${Buffer.from(bytes).toString('base64')}`;
    },
    close: async () => {
      closed = true;
      connected = false;
      socket.end(undefined);
    },
    isConnected: () => connected,
    onStateChanged: (callback) => {
      socket.ev.on('connection.update', (update) => {
        if (update.connection) callback(update.connection);
      });
    },
  };
}

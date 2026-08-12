import { describe, it, expect } from 'vitest';
import {
  allowedMessage,
  isAuthRequiredError,
  normalise,
  shouldIgnoreMessage,
  toIncomingMessage,
} from '../src/openwa.js';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { Config } from '../src/config.js';
const cfg = (ids: string[] = [], names: string[] = []): Config => ({ groupIds: ids, groupNames: names }) as Config;
const group = (id = '123@g.us', name = 'Placement') => ({ chatId: id, isGroupMsg: true, chat: { id, name } });
describe('message boundary', () => {
  it('allows exact group ID', () => expect(allowedMessage(group(), cfg(['123@g.us']))).toBe(true));
  it('rejects another ID even when name matches', () =>
    expect(allowedMessage(group('999@g.us', 'Placement'), cfg(['123@g.us'], ['Placement']))).toBe(false));
  it('uses name only when no IDs are configured', () =>
    expect(allowedMessage(group('123@g.us', 'Placement'), cfg([], ['Placement']))).toBe(true));
  it('rejects direct messages', () =>
    expect(
      allowedMessage({ chatId: '123@c.us', isGroupMsg: false, chat: { name: 'Placement' } }, cfg([], ['Placement'])),
    ).toBe(false));
  it('rejects own and system messages', () => {
    expect(shouldIgnoreMessage({ fromMe: true })).toBe(true);
    expect(shouldIgnoreMessage({ isNotification: true })).toBe(true);
  });
  it('maps chat messages to text', () => {
    const message = normalise({ type: 'chat', chatId: '123@g.us', timestamp: Date.now() / 1000 }, cfg());
    expect(message.type).toBe('text');
  });
  it('maps a Baileys group document without exposing a raw ID in storage', () => {
    const native = {
      key: { remoteJid: '123@g.us', id: 'message-id', participant: 'sender@c.us', fromMe: false },
      messageTimestamp: 1_786_000_000,
      message: { documentMessage: { fileName: 'placement.pdf', mimetype: 'application/pdf', caption: 'JD' } },
    } as unknown as WAMessage;
    const message = toIncomingMessage(native, new Map([['123@g.us', 'Placement']]));
    expect(message).toMatchObject({
      chatId: '123@g.us',
      type: 'document',
      isMedia: true,
      filename: 'placement.pdf',
      chat: { name: 'Placement' },
    });
  });
  it('classifies authentication expiry without treating unknown errors as auth', () => {
    expect(isAuthRequiredError(new Error('Session most likely logged out'))).toBe(true);
    expect(isAuthRequiredError({ output: { statusCode: 401 } })).toBe(true);
    expect(isAuthRequiredError(new Error('network timeout'))).toBe(false);
  });
});

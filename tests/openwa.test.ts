import { describe, it, expect } from 'vitest';
import { allowedMessage, normalise, shouldIgnoreMessage } from '../src/openwa.js';
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
  it('maps OpenWA chat messages to text', () => {
    const message = normalise({ type: 'chat', chatId: '123@g.us', timestamp: Date.now() / 1000 }, cfg());
    expect(message.type).toBe('text');
  });
});

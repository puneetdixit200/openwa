import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
const original = { ...process.env };
function setEnv(values: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  for (const [key, value] of Object.entries(values))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}
const valid = {
  HASH_SALT: '12345678901234567890123456789012',
  ALLOWED_GROUP_IDS: '123@g.us',
  DATA_REPOSITORY_PATH: '/tmp/openwa-data',
  DATA_DIRECTORY: '/tmp/openwa-data/incoming',
  GIT_SYNC_ENABLED: 'false',
};
describe('configuration safety', () => {
  it('rejects a short salt', () => {
    setEnv({ ...valid, HASH_SALT: 'too-short' });
    expect(() => loadConfig('/tmp/openwa-code', false)).toThrow(/32 characters/);
    setEnv(original);
  });
  it('rejects the code repository as the data repository', () => {
    setEnv({ ...valid, DATA_REPOSITORY_PATH: '/tmp/openwa-code', DATA_DIRECTORY: '/tmp/openwa-code/incoming' });
    expect(() => loadConfig('/tmp/openwa-code', false)).toThrow(/separate/);
    setEnv(original);
  });
  it('rejects a data directory outside its repository', () => {
    setEnv({ ...valid, DATA_DIRECTORY: '/tmp/elsewhere' });
    expect(() => loadConfig('/tmp/openwa-code', false)).toThrow(/inside/);
    setEnv(original);
  });
});

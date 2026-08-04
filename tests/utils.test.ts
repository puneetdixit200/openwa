import { describe, it, expect } from 'vitest';
import { redactPhoneNumbers, safeFilename, saltedHash, isoInZone } from '../src/utils.js';
describe('privacy and paths', () => {
  it('hashes with salt', () => expect(saltedHash('secret-secret-secret', '12345')).toHaveLength(16));
  it('redacts phone-like metadata', () =>
    expect(redactPhoneNumbers('Call +91 98765 43210')).toContain('[phone redacted]'));
  it('prevents traversal', () =>
    expect(safeFilename('../../JD evil?.pdf', new Date('2026-08-04T14:35:01Z'), 'abc123456789')).not.toContain('..'));
  it('uses configured timezone date', () =>
    expect(isoInZone(new Date('2026-08-04T18:32:00Z'), 'Asia/Kolkata').date).toBe('2026-08-05'));
});

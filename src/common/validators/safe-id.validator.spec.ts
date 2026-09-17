import { isSafeId } from './safe-id.validator.js';

describe('isSafeId', () => {
  it('accepts normal identifiers', () => {
    expect(isSafeId('invoice')).toBe(true);
    expect(isSafeId('abc-123_XYZ.tar.gz')).toBe(true);
    expect(isSafeId('a')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(isSafeId('..')).toBe(false);
    expect(isSafeId('.')).toBe(false);
    expect(isSafeId('...')).toBe(false);
    expect(isSafeId('../../etc/passwd')).toBe(false);
    expect(isSafeId('a/../b')).toBe(false);
  });

  it('rejects path separators', () => {
    expect(isSafeId('a/b')).toBe(false);
    expect(isSafeId('a\\b')).toBe(false);
  });

  it('rejects empty and non-string values', () => {
    expect(isSafeId('')).toBe(false);
    expect(isSafeId(undefined)).toBe(false);
    expect(isSafeId(123)).toBe(false);
  });

  it('rejects identifiers that are too long', () => {
    expect(isSafeId('a'.repeat(256))).toBe(false);
    expect(isSafeId('a'.repeat(255))).toBe(true);
  });
});

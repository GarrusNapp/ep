import { loadConfig } from './configuration.js';

// Mirrors .env / .example.env — every field except ARCHIVE_PATH/HOT_PATH is
// required, so tests need a complete baseline to override from.
const VALID_ENV = {
  PORT: '3000',
  ALLOWED_TYPES: 'invoice,report',
  ARCHIVE_AFTER_MS: '3600000',
  ARCHIVE_SWEEP_INTERVAL_MS: '60000',
  ARCHIVE_BATCH_SIZE: '500',
  ARCHIVE_PATH: './data/archive',
  HOT_MAX_SIZE: '512MB',
  MAX_FILE_SIZE: '50MB',
  PAGE_SIZE_DEFAULT: '100',
  PAGE_SIZE_MAX: '1000',
  EXISTS_BATCH_MAX: '1000',
};

describe('loadConfig', () => {
  it('parses a fully specified env', () => {
    const config = loadConfig(VALID_ENV);
    expect(config.PORT).toBe(3000);
    expect(config.ALLOWED_TYPES).toEqual(['invoice', 'report']);
    expect(config.ARCHIVE_AFTER_MS).toBe(3600000);
    expect(config.ARCHIVE_SWEEP_INTERVAL_MS).toBe(60000);
    expect(config.EXISTS_BATCH_MAX).toBe(1000);
  });

  it('rejects an empty env — every field is required, no defaults', () => {
    expect(() => loadConfig({})).toThrow(/PORT/);
  });

  it('rejects a partial env missing a single required field', () => {
    const { PORT: _omit, ...rest } = VALID_ENV;
    expect(() => loadConfig(rest)).toThrow(/PORT/);
  });

  it('ARCHIVE_PATH and HOT_PATH are optional — omitting them does not throw', () => {
    const { ARCHIVE_PATH: _a, ...rest } = VALID_ENV;
    const config = loadConfig(rest);
    expect(config.ARCHIVE_PATH).toBeUndefined();
    expect(config.HOT_PATH).toBeUndefined();
  });

  it('parses HOT_PATH when provided', () => {
    const config = loadConfig({ ...VALID_ENV, HOT_PATH: './data/hot' });
    expect(config.HOT_PATH).toBe('./data/hot');
  });

  it('parses and trims ALLOWED_TYPES from env', () => {
    const config = loadConfig({
      ...VALID_ENV,
      ALLOWED_TYPES: ' invoice , archive-x ,, ',
    });
    expect(config.ALLOWED_TYPES).toEqual(['invoice', 'archive-x']);
  });

  it('rejects ALLOWED_TYPES with disallowed characters', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, ALLOWED_TYPES: 'Invoice!' }),
    ).toThrow();
  });

  it('rejects when ARCHIVE_SWEEP_INTERVAL_MS >= ARCHIVE_AFTER_MS', () => {
    expect(() =>
      loadConfig({
        ...VALID_ENV,
        ARCHIVE_AFTER_MS: '1000',
        ARCHIVE_SWEEP_INTERVAL_MS: '1000',
      }),
    ).toThrow(/ARCHIVE_SWEEP_INTERVAL_MS/);
  });

  it('rejects when MAX_FILE_SIZE > HOT_MAX_SIZE', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, MAX_FILE_SIZE: '2000', HOT_MAX_SIZE: '1000' }),
    ).toThrow(/hot storage/);
  });

  it('parses human-readable sizes for HOT_MAX_SIZE / MAX_FILE_SIZE', () => {
    const config = loadConfig({
      ...VALID_ENV,
      HOT_MAX_SIZE: '1GB',
      MAX_FILE_SIZE: '50MB',
    });
    expect(config.HOT_MAX_SIZE).toBe(1024 * 1024 * 1024);
    expect(config.MAX_FILE_SIZE).toBe(50 * 1024 * 1024);
  });

  it('still accepts a plain byte count for HOT_MAX_SIZE / MAX_FILE_SIZE', () => {
    const config = loadConfig({
      ...VALID_ENV,
      HOT_MAX_SIZE: '2048',
      MAX_FILE_SIZE: '1024',
    });
    expect(config.HOT_MAX_SIZE).toBe(2048);
    expect(config.MAX_FILE_SIZE).toBe(1024);
  });

  it('rejects an unparseable size string', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, HOT_MAX_SIZE: 'not-a-size' }),
    ).toThrow(/Invalid size/);
  });

  it('rejects when PAGE_SIZE_DEFAULT > PAGE_SIZE_MAX', () => {
    expect(() =>
      loadConfig({
        ...VALID_ENV,
        PAGE_SIZE_DEFAULT: '500',
        PAGE_SIZE_MAX: '100',
      }),
    ).toThrow(/PAGE_SIZE_DEFAULT/);
  });

  it('rejects invalid non-numeric values', () => {
    expect(() => loadConfig({ ...VALID_ENV, PORT: 'abc' })).toThrow();
  });
});

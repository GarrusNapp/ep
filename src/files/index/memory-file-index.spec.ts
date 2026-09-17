import { AppConfig } from '../../config/app-config.js';
import { FileEntry } from './file-index.js';
import { MemoryFileIndex } from './memory-file-index.js';

const config = { ALLOWED_TYPES: ['invoice', 'report'] } as unknown as AppConfig;

const entry = (overrides: Partial<FileEntry> = {}): FileEntry => ({
  type: 'invoice',
  id: 'a1',
  tier: 'HOT',
  status: 'READY',
  size: 100,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('MemoryFileIndex', () => {
  let index: MemoryFileIndex;

  beforeEach(() => {
    index = new MemoryFileIndex(config);
  });

  describe('upsert/get/getMany/delete', () => {
    it('roundtrips a single entry', async () => {
      await index.upsert(entry());
      expect(await index.get('invoice', 'a1')).toEqual(entry());
    });

    it('get on an unknown type does not throw and returns null', async () => {
      expect(await index.get('unknown-type', 'a1')).toBeNull();
    });

    it('getMany returns only existing entries', async () => {
      await index.upsert(entry({ id: 'a1' }));
      await index.upsert(entry({ id: 'b2' }));
      const result = await index.getMany('invoice', ['a1', 'b2', 'missing']);
      expect(result.size).toBe(2);
      expect(result.get('a1')?.id).toBe('a1');
      expect(result.has('missing')).toBe(false);
    });

    it('delete removes the entry and returns true, a repeated delete returns false', async () => {
      await index.upsert(entry());
      expect(await index.delete('invoice', 'a1')).toBe(true);
      expect(await index.get('invoice', 'a1')).toBeNull();
      expect(await index.delete('invoice', 'a1')).toBe(false);
    });

    it('upsert on an unknown type throws', async () => {
      await expect(index.upsert(entry({ type: 'unknown' }))).rejects.toThrow(
        /unknown type/i,
      );
    });
  });

  describe('listIds — cursor pagination', () => {
    beforeEach(async () => {
      for (const id of ['a1', 'b2', 'c3', 'd4', 'e5']) {
        await index.upsert(entry({ id }));
      }
    });

    it('first page with a limit', async () => {
      const page = await index.listIds('invoice', undefined, 2);
      expect(page.items).toEqual(['a1', 'b2']);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe('b2');
    });

    it('next page after the cursor', async () => {
      const page = await index.listIds('invoice', 'b2', 2);
      expect(page.items).toEqual(['c3', 'd4']);
      expect(page.hasMore).toBe(true);
    });

    it('last page has hasMore=false', async () => {
      const page = await index.listIds('invoice', 'c3', 2);
      expect(page.items).toEqual(['d4', 'e5']);
      expect(page.hasMore).toBe(false);
    });

    it('unknown type returns an empty page', async () => {
      const page = await index.listIds('unknown-type');
      expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
    });
  });

  describe('findExpired', () => {
    it('returns only HOT+READY entries older than the threshold, sorted oldest-first, respecting the limit', async () => {
      await index.upsert(
        entry({ id: 'old', createdAt: new Date('2024-01-01T00:00:00Z') }),
      );
      await index.upsert(
        entry({ id: 'older', createdAt: new Date('2023-01-01T00:00:00Z') }),
      );
      await index.upsert(
        entry({
          id: 'migrating',
          createdAt: new Date('2022-01-01T00:00:00Z'),
          status: 'MIGRATING',
        }),
      );
      await index.upsert(
        entry({
          id: 'archived',
          createdAt: new Date('2022-01-01T00:00:00Z'),
          tier: 'ARCHIVE',
        }),
      );
      await index.upsert(
        entry({ id: 'fresh', createdAt: new Date('2030-01-01T00:00:00Z') }),
      );

      const threshold = new Date('2025-01-01T00:00:00Z');
      const expired = await index.findExpired(threshold, 10);

      expect(expired.map((e) => e.id)).toEqual(['older', 'old']);
    });

    it('respects the limit', async () => {
      await index.upsert(
        entry({ id: 'a1', createdAt: new Date('2020-01-01T00:00:00Z') }),
      );
      await index.upsert(
        entry({ id: 'b2', createdAt: new Date('2021-01-01T00:00:00Z') }),
      );

      const expired = await index.findExpired(
        new Date('2025-01-01T00:00:00Z'),
        1,
      );
      expect(expired).toHaveLength(1);
      expect(expired[0].id).toBe('a1');
    });

    it('scans across all types', async () => {
      await index.upsert(
        entry({
          type: 'invoice',
          id: 'a1',
          createdAt: new Date('2020-01-01T00:00:00Z'),
        }),
      );
      await index.upsert(
        entry({
          type: 'report',
          id: 'b2',
          createdAt: new Date('2020-01-01T00:00:00Z'),
        }),
      );

      const expired = await index.findExpired(
        new Date('2025-01-01T00:00:00Z'),
        10,
      );
      expect(expired.map((e) => e.id).sort()).toEqual(['a1', 'b2']);
    });
  });

  describe('hotBytes — incremental counter', () => {
    it('grows with a new HOT entry', async () => {
      await index.upsert(entry({ id: 'a1', size: 100 }));
      expect(await index.hotBytes()).toBe(100);
      await index.upsert(entry({ id: 'b2', size: 50 }));
      expect(await index.hotBytes()).toBe(150);
    });

    it('adjusts the delta when overwriting a HOT entry', async () => {
      await index.upsert(entry({ id: 'a1', size: 100 }));
      await index.upsert(entry({ id: 'a1', size: 40 }));
      expect(await index.hotBytes()).toBe(40);
    });

    it('decreases on setTier to ARCHIVE', async () => {
      await index.upsert(entry({ id: 'a1', size: 100 }));
      await index.setTier('invoice', 'a1', 'ARCHIVE');
      expect(await index.hotBytes()).toBe(0);
    });

    it('decreases on delete of a HOT entry, unaffected for ARCHIVE', async () => {
      await index.upsert(entry({ id: 'a1', size: 100 }));
      await index.upsert(entry({ id: 'b2', size: 30, tier: 'ARCHIVE' }));

      expect(await index.hotBytes()).toBe(100);

      await index.delete('invoice', 'a1');
      expect(await index.hotBytes()).toBe(0);

      await index.delete('invoice', 'b2');
      expect(await index.hotBytes()).toBe(0);
    });

    it('does not count ARCHIVE entries from the start', async () => {
      await index.upsert(entry({ id: 'a1', size: 100, tier: 'ARCHIVE' }));
      expect(await index.hotBytes()).toBe(0);
    });
  });
});

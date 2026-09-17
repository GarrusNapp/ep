import { MemoryFileStorage } from './memory-file.storage.js';

describe('MemoryFileStorage', () => {
  let storage: MemoryFileStorage;

  beforeEach(() => {
    storage = new MemoryFileStorage();
  });

  it('roundtrip put/get', async () => {
    await storage.put('invoice', 'a1', Buffer.from('hello'));
    const data = await storage.get('invoice', 'a1');
    expect(data?.toString()).toBe('hello');
  });

  it('get on a missing key returns null', async () => {
    expect(await storage.get('invoice', 'missing')).toBeNull();
  });

  it('delete removes it and returns true, a repeated delete returns false', async () => {
    await storage.put('invoice', 'a1', Buffer.from('x'));
    expect(await storage.delete('invoice', 'a1')).toBe(true);
    expect(await storage.delete('invoice', 'a1')).toBe(false);
    expect(await storage.get('invoice', 'a1')).toBeNull();
  });

  it('list returns ids within a type, empty for an unknown type', async () => {
    await storage.put('invoice', 'a1', Buffer.from('x'));
    await storage.put('invoice', 'b2', Buffer.from('y'));
    await storage.put('report', 'c3', Buffer.from('z'));

    expect(await storage.list('invoice')).toEqual(
      expect.arrayContaining(['a1', 'b2']),
    );
    expect(await storage.list('report')).toEqual(['c3']);
    expect(await storage.list('unknown')).toEqual([]);
  });

  it('put overwrites an existing key', async () => {
    await storage.put('invoice', 'a1', Buffer.from('old'));
    await storage.put('invoice', 'a1', Buffer.from('new'));
    expect((await storage.get('invoice', 'a1'))?.toString()).toBe('new');
  });

  it('stat returns size + createdAt, null when missing', async () => {
    const before = Date.now();
    await storage.put('invoice', 'a1', Buffer.from('hello'));
    const after = Date.now();

    const result = await storage.stat('invoice', 'a1');
    expect(result?.size).toBe(5);
    expect(result?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result?.createdAt.getTime()).toBeLessThanOrEqual(after);

    expect(await storage.stat('invoice', 'missing')).toBeNull();
    expect(await storage.stat('unknown-type', 'a1')).toBeNull();
  });

  it('put resets createdAt on overwrite', async () => {
    await storage.put('invoice', 'a1', Buffer.from('old'));
    const first = await storage.stat('invoice', 'a1');

    await new Promise((resolve) => setTimeout(resolve, 5));
    await storage.put('invoice', 'a1', Buffer.from('new'));
    const second = await storage.stat('invoice', 'a1');

    expect(second!.createdAt.getTime()).toBeGreaterThan(
      first!.createdAt.getTime(),
    );
  });
});

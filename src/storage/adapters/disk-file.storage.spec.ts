import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskFileStorage } from './disk-file.storage.js';

describe('DiskFileStorage', () => {
  let dir: string;
  let storage: DiskFileStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'disk-file-storage-'));
    storage = new DiskFileStorage(dir);
    await storage.onModuleInit();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('onModuleInit creates the directory and passes a probe write', async () => {
    // no exception in beforeEach = success; the directory exists and is writable
    await expect(
      storage.put('invoice', 'a1', Buffer.from('x')),
    ).resolves.toBeUndefined();
  });

  it('roundtrip put/get/delete', async () => {
    await storage.put('invoice', 'a1', Buffer.from('hello'));
    expect((await storage.get('invoice', 'a1'))?.toString()).toBe('hello');

    expect(await storage.delete('invoice', 'a1')).toBe(true);
    expect(await storage.get('invoice', 'a1')).toBeNull();
    expect(await storage.delete('invoice', 'a1')).toBe(false);
  });

  it('get/list on an unknown type do not throw, return null/empty list', async () => {
    expect(await storage.get('unknown', 'a1')).toBeNull();
    expect(await storage.list('unknown')).toEqual([]);
  });

  it('list returns the stored ids for a given type', async () => {
    await storage.put('invoice', 'a1', Buffer.from('x'));
    await storage.put('invoice', 'b2', Buffer.from('y'));
    expect(await storage.list('invoice')).toEqual(
      expect.arrayContaining(['a1', 'b2']),
    );
  });

  it('stat returns size + createdAt from the filesystem, null when missing', async () => {
    const before = new Date(Date.now() - 1000); // fs mtime truncates to whole seconds
    await storage.put('invoice', 'a1', Buffer.from('hello'));

    const result = await storage.stat('invoice', 'a1');
    expect(result?.size).toBe(5);
    expect(result?.createdAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );

    expect(await storage.stat('invoice', 'missing')).toBeNull();
    expect(await storage.stat('unknown', 'a1')).toBeNull();
  });

  it('onModuleInit throws a descriptive error when the root path is not writable', async () => {
    const readonlyStorage = new DiskFileStorage(
      '/this/path/should/not/be/creatable/on/most/systems',
    );
    await expect(readonlyStorage.onModuleInit()).rejects.toThrow(
      /DiskFileStorage/,
    );
  });
});

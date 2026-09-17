import { ConflictException, NotFoundException } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import {
  ArchiveStorage,
  FileStorage,
  HotStorage,
} from '../storage/file-storage.js';
import { ArchivalService } from './archival/archival.service.js';
import { FileEntry, FileIndex } from './index/file-index.js';
import { MemoryFileIndex } from './index/memory-file-index.js';
import { FilesService } from './files.service.js';

const makeStorage = (): FileStorage => ({
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
});

const makeIndex = (): FileIndex => ({
  upsert: vi.fn(),
  get: vi.fn(),
  getMany: vi.fn(),
  delete: vi.fn(),
  listIds: vi.fn(),
  setTier: vi.fn(),
  findExpired: vi.fn(),
  hotBytes: vi.fn().mockResolvedValue(0),
});

const config = {
  ALLOWED_TYPES: ['invoice', 'report'],
  HOT_MAX_SIZE: 1_000_000,
} as unknown as AppConfig;

const entry = (overrides: Partial<FileEntry> = {}): FileEntry => ({
  type: 'invoice',
  id: 'a1',
  tier: 'HOT',
  status: 'READY',
  size: 5,
  createdAt: new Date(),
  ...overrides,
});

describe('FilesService', () => {
  let hot: FileStorage;
  let archive: FileStorage;
  let index: FileIndex;
  let archival: ArchivalService;
  let service: FilesService;

  beforeEach(() => {
    hot = makeStorage();
    archive = makeStorage();
    index = makeIndex();
    archival = { triggerImmediateSweep: vi.fn() } as unknown as ArchivalService;
    service = new FilesService(
      hot as HotStorage,
      archive as ArchiveStorage,
      index,
      config,
      archival,
    );
  });

  describe('write', () => {
    it('writes to hot and the index when the id is new', async () => {
      (index.get as any).mockResolvedValue(null);

      await service.write('invoice', 'a1', Buffer.from('hello'));

      expect(hot.put).toHaveBeenCalledWith(
        'invoice',
        'a1',
        Buffer.from('hello'),
      );
      expect(index.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'invoice',
          id: 'a1',
          tier: 'HOT',
          status: 'READY',
          size: 5,
        }),
      );
    });

    it('throws 409 when the id already exists', async () => {
      (index.get as any).mockResolvedValue(entry());

      await expect(
        service.write('invoice', 'a1', Buffer.from('x')),
      ).rejects.toThrow(ConflictException);
      expect(hot.put).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown type', async () => {
      await expect(
        service.write('unknown', 'a1', Buffer.from('x')),
      ).rejects.toThrow(NotFoundException);
    });

    it('triggers an immediate sweep once HOT_MAX_SIZE is exceeded', async () => {
      (index.get as any).mockResolvedValue(null);
      (index.hotBytes as any).mockResolvedValue(config.HOT_MAX_SIZE + 1);

      await service.write('invoice', 'a1', Buffer.from('x'));

      expect(archival.triggerImmediateSweep).toHaveBeenCalled();
    });

    it('does not trigger a sweep below the limit', async () => {
      (index.get as any).mockResolvedValue(null);
      (index.hotBytes as any).mockResolvedValue(config.HOT_MAX_SIZE - 1);

      await service.write('invoice', 'a1', Buffer.from('x'));

      expect(archival.triggerImmediateSweep).not.toHaveBeenCalled();
    });
  });

  describe('read', () => {
    it('reads from the adapter pointed to by the entry tier', async () => {
      (index.get as any).mockResolvedValue(entry({ tier: 'ARCHIVE' }));
      (archive.get as any).mockResolvedValue(Buffer.from('bytes'));

      const result = await service.read('invoice', 'a1');

      expect(archive.get).toHaveBeenCalledWith('invoice', 'a1');
      expect(hot.get).not.toHaveBeenCalled();
      expect(result.data.toString()).toBe('bytes');
    });

    it('throws 404 when the entry is not in the index', async () => {
      (index.get as any).mockResolvedValue(null);
      await expect(service.read('invoice', 'a1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is not blocked by MIGRATING status', async () => {
      (index.get as any).mockResolvedValue(entry({ status: 'MIGRATING' }));
      (hot.get as any).mockResolvedValue(Buffer.from('bytes'));

      await expect(service.read('invoice', 'a1')).resolves.toBeDefined();
    });
  });

  describe('head', () => {
    it('never touches the adapter', async () => {
      (index.get as any).mockResolvedValue(entry());
      await service.head('invoice', 'a1');
      expect(hot.get).not.toHaveBeenCalled();
      expect(archive.get).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes bytes first, then the index', async () => {
      (index.get as any).mockResolvedValue(entry());
      const order: string[] = [];
      (hot.delete as any).mockImplementation(async () => {
        order.push('adapter');
        return true;
      });
      (index.delete as any).mockImplementation(async () => {
        order.push('index');
        return true;
      });

      await service.delete('invoice', 'a1');

      expect(order).toEqual(['adapter', 'index']);
    });

    it('throws 409 while migration is in progress', async () => {
      (index.get as any).mockResolvedValue(entry({ status: 'MIGRATING' }));
      await expect(service.delete('invoice', 'a1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws 404 when the file does not exist', async () => {
      (index.get as any).mockResolvedValue(null);
      await expect(service.delete('invoice', 'a1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('existsBatch', () => {
    it('returns an explicit null for missing ids', async () => {
      (index.getMany as any).mockResolvedValue(
        new Map([['a1', entry({ tier: 'HOT' })]]),
      );

      const result = await service.existsBatch('invoice', ['a1', 'missing']);

      expect(result).toEqual({ a1: 'HOT', missing: null });
    });
  });

  describe('list', () => {
    it('throws 404 for an unknown type', async () => {
      await expect(service.list('unknown', undefined, 10)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('onModuleInit — reconciliation', () => {
    // Uses a real MemoryFileIndex (already covered by its own unit tests) so
    // we can assert actual post-reconcile state, not just mock call shapes.
    const buildService = () => {
      const realIndex = new MemoryFileIndex(config);
      const svc = new FilesService(
        hot as HotStorage,
        archive as ArchiveStorage,
        realIndex,
        config,
        archival,
      );
      return { svc, realIndex };
    };

    it('reconciles files already sitting in archive storage', async () => {
      (archive.list as any).mockImplementation(async (type: string) =>
        type === 'invoice' ? ['a1'] : [],
      );
      (archive.stat as any).mockResolvedValue({
        size: 42,
        createdAt: new Date('2020-01-01T00:00:00Z'),
      });

      const { svc, realIndex } = buildService();
      await svc.onModuleInit();

      await expect(realIndex.get('invoice', 'a1')).resolves.toEqual(
        expect.objectContaining({ tier: 'ARCHIVE', status: 'READY', size: 42 }),
      );
    });

    it('reconciles files already sitting in hot storage', async () => {
      (hot.list as any).mockImplementation(async (type: string) =>
        type === 'invoice' ? ['h1'] : [],
      );
      (hot.stat as any).mockResolvedValue({
        size: 10,
        createdAt: new Date('2021-01-01T00:00:00Z'),
      });

      const { svc, realIndex } = buildService();
      await svc.onModuleInit();

      await expect(realIndex.get('invoice', 'h1')).resolves.toEqual(
        expect.objectContaining({ tier: 'HOT', status: 'READY', size: 10 }),
      );
    });

    it('archive wins when the same id exists in both tiers', async () => {
      (archive.list as any).mockImplementation(async (type: string) =>
        type === 'invoice' ? ['dup'] : [],
      );
      (archive.stat as any).mockResolvedValue({
        size: 42,
        createdAt: new Date(),
      });
      (hot.list as any).mockImplementation(async (type: string) =>
        type === 'invoice' ? ['dup'] : [],
      );
      (hot.stat as any).mockResolvedValue({ size: 99, createdAt: new Date() });

      const { svc, realIndex } = buildService();
      await svc.onModuleInit();

      const found = await realIndex.get('invoice', 'dup');
      expect(found?.tier).toBe('ARCHIVE');
      expect(found?.size).toBe(42);
    });

    it('skips ids whose stat() returns null (raced away between list and stat)', async () => {
      (hot.list as any).mockImplementation(async (type: string) =>
        type === 'invoice' ? ['gone'] : [],
      );
      (hot.stat as any).mockResolvedValue(null);

      const { svc, realIndex } = buildService();
      await svc.onModuleInit();

      await expect(realIndex.get('invoice', 'gone')).resolves.toBeNull();
    });
  });
});

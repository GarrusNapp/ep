import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfig } from '../../config/app-config.js';
import {
  ArchiveStorage,
  FileStorage,
  HotStorage,
} from '../../storage/file-storage.js';
import { FileEntry, FileIndex } from '../index/file-index.js';
import { ArchivalService } from './archival.service.js';

const makeStorage = (): FileStorage => ({
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  stat: vi.fn(),
});

const makeIndex = (): FileIndex => ({
  upsert: vi.fn(),
  get: vi.fn(),
  getMany: vi.fn(),
  delete: vi.fn(),
  listIds: vi.fn(),
  setTier: vi.fn(),
  findExpired: vi.fn().mockResolvedValue([]),
  hotBytes: vi.fn(),
});

const makeScheduler = (): SchedulerRegistry =>
  ({
    addInterval: vi.fn(),
    deleteInterval: vi.fn(),
    doesExist: vi.fn().mockReturnValue(true),
  }) as unknown as SchedulerRegistry;

const config = {
  ARCHIVE_AFTER_MS: 1000,
  ARCHIVE_BATCH_SIZE: 500,
  ARCHIVE_SWEEP_INTERVAL_MS: 5000,
} as AppConfig;

const entry = (overrides: Partial<FileEntry> = {}): FileEntry => ({
  type: 'invoice',
  id: 'a1',
  tier: 'HOT',
  status: 'READY',
  size: 5,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('ArchivalService', () => {
  let hot: FileStorage;
  let archive: FileStorage;
  let index: FileIndex;
  let scheduler: SchedulerRegistry;
  let service: ArchivalService;

  beforeEach(() => {
    hot = makeStorage();
    archive = makeStorage();
    index = makeIndex();
    scheduler = makeScheduler();
    service = new ArchivalService(
      hot as HotStorage,
      archive as ArchiveStorage,
      index,
      config,
      scheduler,
    );
  });

  it('onModuleInit registers a sweep interval sized from config', () => {
    // stub out the real timer entirely — we only care that setInterval was
    // asked for the right delay and that its handle reached the registry
    const fakeHandle = {} as NodeJS.Timeout;
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(fakeHandle);

    service.onModuleInit();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      config.ARCHIVE_SWEEP_INTERVAL_MS,
    );
    expect(scheduler.addInterval).toHaveBeenCalledWith(
      'archival-sweep',
      fakeHandle,
    );

    setIntervalSpy.mockRestore();
  });

  it('onModuleDestroy clears the registered interval', () => {
    service.onModuleDestroy();
    expect(scheduler.deleteInterval).toHaveBeenCalledWith('archival-sweep');
  });

  it('guard: overlapping runs — the second one is a no-op', async () => {
    let resolveFindExpired!: (value: FileEntry[]) => void;
    (index.findExpired as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFindExpired = resolve;
      }),
    );

    const first = service.sweep();
    const second = service.sweep(); // should return immediately, running=true

    resolveFindExpired([]);
    await Promise.all([first, second]);

    expect(index.findExpired).toHaveBeenCalledTimes(1);
  });

  it('happy path: call order MIGRATING -> archive.put -> ARCHIVE/READY -> hot.delete', async () => {
    const e = entry();
    (index.findExpired as any).mockResolvedValue([e]);
    (index.get as any).mockResolvedValue(e);
    (hot.get as any).mockResolvedValue(Buffer.from('hello'));

    const calls: string[] = [];
    (index.upsert as any).mockImplementation(async (updated: FileEntry) => {
      calls.push(`upsert:${updated.tier}:${updated.status}`);
    });
    (archive.put as any).mockImplementation(async () => {
      calls.push('archive.put');
    });
    (hot.delete as any).mockImplementation(async () => {
      calls.push('hot.delete');
    });

    await service.sweep();

    expect(calls).toEqual([
      'upsert:HOT:MIGRATING',
      'archive.put',
      'upsert:ARCHIVE:READY',
      'hot.delete',
    ]);
  });

  it('file disappeared from hot during migration: reverts status, skips further steps', async () => {
    const e = entry();
    (index.findExpired as any).mockResolvedValue([e]);
    (index.get as any).mockResolvedValue(e);
    (hot.get as any).mockResolvedValue(null);

    await service.sweep();

    expect(archive.put).not.toHaveBeenCalled();
    expect(index.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'READY' }),
    );
  });

  it('one failure does not abort the rest of the batch and reverts MIGRATING to READY', async () => {
    const ok = entry({ id: 'ok', size: 5 });
    const broken = entry({ id: 'broken', size: 5 });
    (index.findExpired as any).mockResolvedValue([broken, ok]);
    (index.get as any).mockImplementation(async (_type: string, id: string) =>
      id === 'broken' ? broken : ok,
    );
    (hot.get as any).mockImplementation(async (_type: string, id: string) => {
      if (id === 'broken') throw new Error('boom');
      return Buffer.from('hello'); // 5 bytes — matches entry.size
    });

    await service.sweep();

    expect(index.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'broken', status: 'READY', tier: 'HOT' }),
    );
    expect(index.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ok', tier: 'ARCHIVE' }),
    );
  });

  it('triggerImmediateSweep runs sweep right away, respecting the guard', async () => {
    (index.findExpired as any).mockResolvedValue([]);
    await service.triggerImmediateSweep();
    expect(index.findExpired).toHaveBeenCalledTimes(1);
  });

  it('triggerImmediateSweep archives files regardless of ARCHIVE_AFTER_MS, unlike a regular sweep', async () => {
    const fresh = entry({ createdAt: new Date() });
    (index.findExpired as any).mockImplementation(
      async (olderThan: Date, limit: number) =>
        fresh.createdAt < olderThan ? [fresh].slice(0, limit) : [],
    );
    (index.get as any).mockResolvedValue(fresh);
    (hot.get as any).mockResolvedValue(Buffer.from('hello'));

    await service.triggerImmediateSweep();

    expect(archive.put).toHaveBeenCalledWith(
      fresh.type,
      fresh.id,
      Buffer.from('hello'),
    );
  });
});

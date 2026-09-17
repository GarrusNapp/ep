import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfig } from '../../config/app-config.js';
import { ArchiveStorage, HotStorage } from '../../storage/file-storage.js';
import { FileEntry, FileIndex } from '../index/file-index.js';

const SWEEP_INTERVAL_NAME = 'archival-sweep';

@Injectable()
export class ArchivalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArchivalService.name);
  private running = false;

  constructor(
    private readonly hot: HotStorage,
    private readonly archive: ArchiveStorage,
    private readonly index: FileIndex,
    private readonly config: AppConfig,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.sweep();
    }, this.config.ARCHIVE_SWEEP_INTERVAL_MS);
    this.scheduler.addInterval(SWEEP_INTERVAL_NAME, interval);
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', SWEEP_INTERVAL_NAME)) {
      this.scheduler.deleteInterval(SWEEP_INTERVAL_NAME);
    }
  }

  // Called when HOT storage exceeds HOT_MAX_SIZE
  async triggerImmediateSweep(): Promise<void> {
    await this.sweep({ ignoreAge: true });
  }

  async sweep(opts?: { ignoreAge?: boolean }): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const threshold = opts?.ignoreAge
        ? new Date(Date.now() + 1) // +1ms so a file created this same tick still qualifies
        : new Date(Date.now() - this.config.ARCHIVE_AFTER_MS);
      const candidates = await this.index.findExpired(
        threshold,
        this.config.ARCHIVE_BATCH_SIZE,
      );
      for (const candidate of candidates) {
        try {
          await this.migrateOne(candidate);
        } catch (error) {
          this.logger.error(
            `Archiving file ${candidate.type}/${candidate.id} failed: ${(error as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async migrateOne(candidate: FileEntry): Promise<void> {
    const current = await this.index.get(candidate.type, candidate.id);
    if (!current || current.status !== 'READY' || current.tier !== 'HOT')
      return;
    // mark as migrating, ensure reverting that status if err occurs
    await this.index.upsert({ ...current, status: 'MIGRATING' });

    try {
      const data = await this.hot.get(candidate.type, candidate.id);
      if (!data) {
        this.logger.warn(
          `File ${candidate.type}/${candidate.id} disappeared from hot storage during migration — skipping`,
        );
        await this.index.upsert({ ...current, status: 'READY' });
        return;
      }

      await this.archive.put(candidate.type, candidate.id, data);

      await this.index.upsert({ ...current, tier: 'ARCHIVE', status: 'READY' });
      await this.hot.delete(candidate.type, candidate.id);
    } catch (error) {
      await this.index.upsert({ ...current, status: 'READY' });
      throw error;
    }
  }
}

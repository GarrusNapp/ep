import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { FileType, SafeId } from '../common/ids.js';
import {
  ArchiveStorage,
  FileStorage,
  HotStorage,
} from '../storage/file-storage.js';
import { ArchivalService } from './archival/archival.service.js';
import { FileEntry, FileIndex, Page, Tier } from './index/file-index.js';

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly allowedTypes: Set<FileType>;

  constructor(
    private readonly hot: HotStorage,
    private readonly archive: ArchiveStorage,
    private readonly index: FileIndex,
    private readonly config: AppConfig,
    private readonly archival: ArchivalService,
  ) {
    this.allowedTypes = new Set(config.ALLOWED_TYPES);
  }

  async onModuleInit(): Promise<void> {
    await this.reconcileTier('ARCHIVE', this.archive);
    await this.reconcileTier('HOT', this.hot);
  }

  private async reconcileTier(tier: Tier, storage: FileStorage): Promise<void> {
    for (const type of this.config.ALLOWED_TYPES) {
      const ids = await storage.list(type);
      for (const id of ids) {
        const existing = await this.index.get(type, id);
        if (existing) continue;

        const stat = await storage.stat(type, id);
        if (!stat) continue; // disappeared between list() and stat()

        await this.index.upsert({
          type,
          id,
          tier,
          status: 'READY',
          size: stat.size,
          createdAt: stat.createdAt,
        });
      }
    }
  }

  private assertKnownType(type: FileType): void {
    if (!this.allowedTypes.has(type)) {
      throw new NotFoundException(`Unknown type: ${type}`);
    }
  }

  private storageFor(tier: Tier): FileStorage {
    return tier === 'HOT' ? this.hot : this.archive;
  }

  async write(type: FileType, id: SafeId, data: Buffer): Promise<void> {
    this.assertKnownType(type);
    const existing = await this.index.get(type, id);
    if (existing) {
      throw new ConflictException(`File ${type}/${id} already exists`);
    }

    await this.hot.put(type, id, data);
    await this.index.upsert({
      type,
      id,
      tier: 'HOT',
      status: 'READY',
      size: data.length,
      createdAt: new Date(),
    });

    const hotBytes = await this.index.hotBytes();
    if (hotBytes > this.config.HOT_MAX_SIZE) {
      this.logger.log(
        `HOT storage at ${hotBytes} bytes (limit ${this.config.HOT_MAX_SIZE}) — triggering immediate archival sweep`,
      );
      void this.archival.triggerImmediateSweep();
    }
  }

  async read(
    type: FileType,
    id: SafeId,
  ): Promise<{ data: Buffer; entry: FileEntry }> {
    const entry = await this.getEntryOrThrow(type, id);
    const data = await this.storageFor(entry.tier).get(type, id);
    if (!data) {
      throw new NotFoundException(`File ${type}/${id} does not exist`);
    }
    return { data, entry };
  }

  async head(type: FileType, id: SafeId): Promise<FileEntry> {
    return this.getEntryOrThrow(type, id);
  }

  async delete(type: FileType, id: SafeId): Promise<void> {
    const entry = await this.getEntryOrThrow(type, id);
    if (entry.status === 'MIGRATING') {
      throw new ConflictException(
        `File ${type}/${id} is currently being archived`,
      );
    }
    await this.storageFor(entry.tier).delete(type, id);
    await this.index.delete(type, id);
  }

  async list(
    type: FileType,
    cursor: SafeId | undefined,
    limit: number,
  ): Promise<Page<SafeId>> {
    this.assertKnownType(type);
    return this.index.listIds(type, cursor, limit);
  }

  async existsBatch(
    type: FileType,
    ids: SafeId[],
  ): Promise<Record<SafeId, Tier | null>> {
    this.assertKnownType(type);
    const found = await this.index.getMany(type, ids);
    const result: Record<SafeId, Tier | null> = {};
    for (const id of ids) {
      result[id] = found.get(id)?.tier ?? null;
    }
    return result;
  }

  private async getEntryOrThrow(
    type: FileType,
    id: SafeId,
  ): Promise<FileEntry> {
    this.assertKnownType(type);
    const entry = await this.index.get(type, id);
    if (!entry) {
      throw new NotFoundException(`File ${type}/${id} does not exist`);
    }
    return entry;
  }
}

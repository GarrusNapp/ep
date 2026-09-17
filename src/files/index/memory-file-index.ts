import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { FileType, SafeId } from '../../common/ids.js';
import { FileEntry, FileIndex, Page, Tier } from './file-index.js';

@Injectable()
export class MemoryFileIndex implements FileIndex {
  private readonly byType = new Map<FileType, Map<SafeId, FileEntry>>();
  private hotByteCount = 0;

  constructor(config: AppConfig) {
    for (const type of config.ALLOWED_TYPES) {
      this.byType.set(type, new Map());
    }
  }

  private mapForWrite(type: FileType): Map<SafeId, FileEntry> {
    const map = this.byType.get(type);
    if (!map) {
      throw new Error(
        `MemoryFileIndex: unknown type "${type}" — not in ALLOWED_TYPES`,
      );
    }
    return map;
  }

  private adjustHotBytes(
    previous: FileEntry | undefined,
    next: FileEntry | undefined,
  ): void {
    const wasHot = previous && previous.tier === 'HOT';
    const isHot = next && next.tier === 'HOT';
    if (wasHot && isHot) {
      this.hotByteCount += next.size - previous.size;
    } else if (!wasHot && isHot) {
      this.hotByteCount += next.size;
    } else if (wasHot && !isHot) {
      this.hotByteCount -= previous.size;
    }
  }

  async upsert(entry: FileEntry): Promise<void> {
    const map = this.mapForWrite(entry.type);
    const previous = map.get(entry.id);
    map.set(entry.id, entry);
    this.adjustHotBytes(previous, entry);
  }

  async get(type: FileType, id: SafeId): Promise<FileEntry | null> {
    return this.byType.get(type)?.get(id) ?? null;
  }

  async getMany(
    type: FileType,
    ids: SafeId[],
  ): Promise<Map<SafeId, FileEntry>> {
    const result = new Map<SafeId, FileEntry>();
    const map = this.byType.get(type);
    if (!map) return result;
    for (const id of ids) {
      const entry = map.get(id);
      if (entry) result.set(id, entry);
    }
    return result;
  }

  async delete(type: FileType, id: SafeId): Promise<boolean> {
    const map = this.byType.get(type);
    const entry = map?.get(id);
    if (!map || !entry) return false;
    map.delete(id);
    this.adjustHotBytes(entry, undefined);
    return true;
  }

  async listIds(
    type: FileType,
    cursor?: SafeId,
    limit = 100,
  ): Promise<Page<SafeId>> {
    const map = this.byType.get(type);
    const ids = map ? [...map.keys()].sort() : [];
    const filtered = cursor ? ids.filter((id) => id > cursor) : ids;
    const items = filtered.slice(0, limit);
    return {
      items,
      nextCursor: items.length > 0 ? items[items.length - 1] : null,
      hasMore: filtered.length > items.length,
    };
  }

  async setTier(type: FileType, id: SafeId, tier: Tier): Promise<void> {
    const map = this.mapForWrite(type);
    const previous = map.get(id);
    if (!previous) return;
    const next = { ...previous, tier };
    map.set(id, next);
    this.adjustHotBytes(previous, next);
  }

  async findExpired(olderThan: Date, limit: number): Promise<FileEntry[]> {
    const candidates: FileEntry[] = [];
    for (const map of this.byType.values()) {
      for (const entry of map.values()) {
        if (
          entry.tier === 'HOT' &&
          entry.status === 'READY' &&
          entry.createdAt < olderThan
        ) {
          candidates.push(entry);
        }
      }
    }
    candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return candidates.slice(0, limit);
  }

  async hotBytes(): Promise<number> {
    return this.hotByteCount;
  }
}

import { FileType, SafeId } from '../../common/ids.js';

export type Tier = 'HOT' | 'ARCHIVE';
export type EntryStatus = 'READY' | 'MIGRATING';

export interface FileEntry {
  type: FileType;
  id: SafeId;
  tier: Tier;
  status: EntryStatus;
  size: number;
  createdAt: Date;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export abstract class FileIndex {
  abstract upsert(entry: FileEntry): Promise<void>;
  abstract get(type: FileType, id: SafeId): Promise<FileEntry | null>;
  abstract getMany(
    type: FileType,
    ids: SafeId[],
  ): Promise<Map<SafeId, FileEntry>>;
  abstract delete(type: FileType, id: SafeId): Promise<boolean>;
  abstract listIds(
    type: FileType,
    cursor?: SafeId,
    limit?: number,
  ): Promise<Page<SafeId>>;
  abstract setTier(type: FileType, id: SafeId, tier: Tier): Promise<void>;
  abstract findExpired(olderThan: Date, limit: number): Promise<FileEntry[]>;
  abstract hotBytes(): Promise<number>;
}

import { FileType, SafeId } from '../common/ids.js';

export interface FileStat {
  size: number;
  createdAt: Date;
}

export abstract class FileStorage {
  abstract put(type: FileType, id: SafeId, data: Buffer): Promise<void>;
  abstract get(type: FileType, id: SafeId): Promise<Buffer | null>;
  abstract delete(type: FileType, id: SafeId): Promise<boolean>;
  abstract list(type: FileType): Promise<SafeId[]>;
  abstract stat(type: FileType, id: SafeId): Promise<FileStat | null>;
}

export abstract class HotStorage extends FileStorage { }
export abstract class ArchiveStorage extends FileStorage { }

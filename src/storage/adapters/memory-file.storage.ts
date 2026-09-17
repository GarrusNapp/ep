import { Injectable } from '@nestjs/common';
import { FileType, SafeId } from '../../common/ids.js';
import { FileStat, FileStorage } from '../file-storage.js';

interface StoredFile {
  data: Buffer;
  createdAt: Date;
}

@Injectable()
export class MemoryFileStorage implements FileStorage {
  private readonly files = new Map<FileType, Map<SafeId, StoredFile>>();

  async put(type: FileType, id: SafeId, data: Buffer): Promise<void> {
    let byId = this.files.get(type);
    if (!byId) {
      byId = new Map();
      this.files.set(type, byId);
    }
    byId.set(id, { data, createdAt: new Date() });
  }

  async get(type: FileType, id: SafeId): Promise<Buffer | null> {
    return this.files.get(type)?.get(id)?.data ?? null;
  }

  async delete(type: FileType, id: SafeId): Promise<boolean> {
    return this.files.get(type)?.delete(id) ?? false;
  }

  async list(type: FileType): Promise<SafeId[]> {
    return [...(this.files.get(type)?.keys() ?? [])];
  }

  async stat(type: FileType, id: SafeId): Promise<FileStat | null> {
    const file = this.files.get(type)?.get(id);
    return file ? { size: file.data.length, createdAt: file.createdAt } : null;
  }
}

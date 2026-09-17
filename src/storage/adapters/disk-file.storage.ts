import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { FileType, SafeId } from '../../common/ids.js';
import { FileStat, FileStorage } from '../file-storage.js';

const isNotFound = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException)?.code === 'ENOENT';

@Injectable()
export class DiskFileStorage implements FileStorage, OnModuleInit {
  constructor(private readonly rootPath: string) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureRootPathExists();
    } catch (error) {
      throw new Error(
        `DiskFileStorage: failed to initialize root path (${this.rootPath}): ${(error as Error).message}`,
      );
    }
  }

  private async ensureRootPathExists(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true });
    const probe = join(this.rootPath, '.probe');
    await writeFile(probe, '');
    await rm(probe, { force: true });
  }

  private typeDir(type: FileType): string {
    return join(this.rootPath, type);
  }

  private filePath(type: FileType, id: SafeId): string {
    return join(this.typeDir(type), id);
  }

  async put(type: FileType, id: SafeId, data: Buffer): Promise<void> {
    await mkdir(this.typeDir(type), { recursive: true });
    await writeFile(this.filePath(type, id), data);
  }

  async get(type: FileType, id: SafeId): Promise<Buffer | null> {
    try {
      return await readFile(this.filePath(type, id));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(type: FileType, id: SafeId): Promise<boolean> {
    try {
      await rm(this.filePath(type, id));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async list(type: FileType): Promise<SafeId[]> {
    try {
      return await readdir(this.typeDir(type));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async stat(type: FileType, id: SafeId): Promise<FileStat | null> {
    try {
      const stats = await stat(this.filePath(type, id));
      // birthtime is unreliable on some Linux filesystems (reports epoch 0);
      // fall back to mtime rather than claim a bogus creation date.
      const createdAt =
        stats.birthtime.getTime() > 0 ? stats.birthtime : stats.mtime;
      return { size: stats.size, createdAt };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

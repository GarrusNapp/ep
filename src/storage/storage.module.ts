import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { HotStorage, ArchiveStorage } from './file-storage.js';
import { MemoryFileStorage } from './adapters/memory-file.storage.js';
import { DiskFileStorage } from './adapters/disk-file.storage.js';

function requirePath(path: string | undefined, envVar: string): string {
  if (!path) {
    throw new Error(
      `${envVar} is required when DiskFileStorage is used for this tier`,
    );
  }
  return path;
}

@Module({
  providers: [
    { provide: HotStorage, useClass: MemoryFileStorage },
    {
      provide: ArchiveStorage,
      useFactory: (config: AppConfig) =>
        new DiskFileStorage(requirePath(config.ARCHIVE_PATH, 'ARCHIVE_PATH')),
      inject: [AppConfig],
    },
  ],
  exports: [HotStorage, ArchiveStorage],
})
export class StorageModule { }

import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { ArchivalService } from './archival/archival.service.js';
import { FileIndex } from './index/file-index.js';
import { MemoryFileIndex } from './index/memory-file-index.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({
  imports: [StorageModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    ArchivalService,
    { provide: FileIndex, useClass: MemoryFileIndex },
  ],
})
export class FilesModule {}

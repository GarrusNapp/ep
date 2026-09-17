import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module.js';
import { StorageModule } from './storage/storage.module.js';
import { FilesModule } from './files/files.module.js';

@Module({
  imports: [ConfigModule, ScheduleModule.forRoot(), StorageModule, FilesModule],
})
export class AppModule {}

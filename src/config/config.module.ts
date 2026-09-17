import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config.js';
import { loadConfig } from './configuration.js';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
    }),
  ],
  providers: [{ provide: AppConfig, useFactory: () => loadConfig() }],
  exports: [AppConfig],
})
export class ConfigModule {}

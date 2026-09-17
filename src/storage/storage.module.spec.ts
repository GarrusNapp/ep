import { Test } from '@nestjs/testing';
import { AppConfig } from '../config/app-config.js';
import { ConfigModule } from '../config/config.module.js';
import { ArchiveStorage, HotStorage } from './file-storage.js';
import { StorageModule } from './storage.module.js';

// AppConfig is provided by the @Global() ConfigModule in the real app, not by
// StorageModule itself — importing ConfigModule here (then overriding its
// provider) makes AppConfig resolvable, matching how DI actually finds it.
describe('StorageModule', () => {
  it('resolves HotStorage/ArchiveStorage when ARCHIVE_PATH is set', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, StorageModule],
    })
      .overrideProvider(AppConfig)
      .useValue({
        ARCHIVE_PATH: '/tmp/storage-module-spec-archive',
      } as AppConfig)
      .compile();

    expect(moduleRef.get(HotStorage)).toBeDefined();
    expect(moduleRef.get(ArchiveStorage)).toBeDefined();
  });

  it('throws a clear error when ARCHIVE_PATH is missing', async () => {
    await expect(
      Test.createTestingModule({ imports: [ConfigModule, StorageModule] })
        .overrideProvider(AppConfig)
        .useValue({} as AppConfig)
        .compile(),
    ).rejects.toThrow(/ARCHIVE_PATH/);
  });
});

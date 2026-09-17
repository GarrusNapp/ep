import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { AppConfig } from '../src/config/app-config.js';
import { AppConfigShape, loadConfig } from '../src/config/configuration.js';
import { ArchivalService } from '../src/files/archival/archival.service.js';
import { DiskFileStorage } from '../src/storage/adapters/disk-file.storage.js';
import { HotStorage } from '../src/storage/file-storage.js';

// Mirrors .env / .example.env — every field is required (no defaults in the
// schema), so tests need a complete baseline env to override from.
const BASE_ENV = {
  PORT: '3000',
  ALLOWED_TYPES: 'invoice,report',
  ARCHIVE_AFTER_MS: '3600000',
  ARCHIVE_SWEEP_INTERVAL_MS: '60000',
  ARCHIVE_BATCH_SIZE: '500',
  ARCHIVE_PATH: './data/archive',
  HOT_MAX_SIZE: '512MB',
  MAX_FILE_SIZE: '50MB',
  PAGE_SIZE_DEFAULT: '100',
  PAGE_SIZE_MAX: '1000',
  EXISTS_BATCH_MAX: '1000',
};

// superagent has no default parser for application/octet-stream — without
// this, res.body/res.text stay empty even though the server sends the bytes correctly.
const asBuffer = (test: request.Test) =>
  test.buffer(true).parse((res, callback) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });

interface TestApp {
  app: INestApplication<App>;
  archivalService: ArchivalService;
  archiveDir: string;
}

async function createTestApp(
  overrides: Partial<AppConfigShape> = {},
): Promise<TestApp> {
  const archiveDir = await mkdtemp(join(tmpdir(), 'files-e2e-'));
  const config: AppConfigShape = {
    ...loadConfig(BASE_ENV),
    ARCHIVE_PATH: archiveDir,
    ...overrides,
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfig)
    .useValue(config)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();

  return { app, archivalService: moduleRef.get(ArchivalService), archiveDir };
}

async function closeTestApp({ app, archiveDir }: TestApp): Promise<void> {
  await app.close();
  await rm(archiveDir, { recursive: true, force: true });
}

describe('Files (e2e)', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
  });

  afterEach(async () => {
    await closeTestApp(testApp);
  });

  it('happy path: create -> get -> head -> delete -> get 404', async () => {
    const server = testApp.app.getHttpServer();

    await request(server)
      .post('/files/invoice/a1')
      .attach('file', Buffer.from('hello world'), 'a1.txt')
      .expect(201);

    const getRes = await asBuffer(
      request(server).get('/files/invoice/a1'),
    ).expect(200);
    expect(getRes.body.toString()).toBe('hello world');
    expect(getRes.headers['x-storage-tier']).toBe('HOT');

    await request(server)
      .head('/files/invoice/a1')
      .expect(200)
      .expect('X-Storage-Tier', 'HOT');

    await request(server).delete('/files/invoice/a1').expect(204);
    await request(server).get('/files/invoice/a1').expect(404);
  });

  it('POST returns 409 when the id already exists', async () => {
    const server = testApp.app.getHttpServer();

    await request(server)
      .post('/files/invoice/dup')
      .attach('file', Buffer.from('one'), 'a.txt')
      .expect(201);

    await request(server)
      .post('/files/invoice/dup')
      .attach('file', Buffer.from('two'), 'b.txt')
      .expect(409);
  });

  it('POST without a file returns 400', async () => {
    await request(testApp.app.getHttpServer())
      .post('/files/invoice/no-file')
      .expect(400);
  });

  it('unknown type -> 404 on all endpoints', async () => {
    const server = testApp.app.getHttpServer();

    await request(server)
      .post('/files/unknown-type/a1')
      .attach('file', Buffer.from('x'), 'a.txt')
      .expect(404);
    await request(server).get('/files/unknown-type/a1').expect(404);
    await request(server).head('/files/unknown-type/a1').expect(404);
    await request(server).delete('/files/unknown-type/a1').expect(404);
    await request(server).get('/files/unknown-type').expect(404);
    await request(server)
      .post('/files/unknown-type/_exists')
      .send({ ids: ['a1'] })
      .expect(404);
  });

  it('_exists returns an explicit null for missing ids', async () => {
    const server = testApp.app.getHttpServer();

    await request(server)
      .post('/files/invoice/present')
      .attach('file', Buffer.from('x'), 'a.txt')
      .expect(201);

    const res = await request(server)
      .post('/files/invoice/_exists')
      .send({ ids: ['present', 'missing'] })
      .expect(200);

    expect(res.body).toEqual({ present: 'HOT', missing: null });
  });

  it('_exists returns 400 when EXISTS_BATCH_MAX is exceeded', async () => {
    const { app, archiveDir } = await createTestApp({ EXISTS_BATCH_MAX: 3 });
    try {
      await request(app.getHttpServer())
        .post('/files/invoice/_exists')
        .send({ ids: ['a1', 'b2'] })
        .expect(200);

      await request(app.getHttpServer())
        .post('/files/invoice/_exists')
        .send({ ids: ['a1', 'b2', 'c3', 'd4'] })
        .expect(400);
    } finally {
      await app.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  });

  it('cursor pagination: walks pages down to hasMore=false', async () => {
    const server = testApp.app.getHttpServer();
    const ids = ['a1', 'b2', 'c3', 'd4', 'e5'];
    for (const id of ids) {
      await request(server)
        .post(`/files/invoice/${id}`)
        .attach('file', Buffer.from(id), `${id}.txt`)
        .expect(201);
    }

    const collected: string[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    let guard = 0;

    while (hasMore && guard < 10) {
      guard += 1;
      const res = await request(server)
        .get('/files/invoice')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .expect(200);
      collected.push(...res.body.ids);
      hasMore = res.body.hasMore;
      cursor = res.body.nextCursor;
    }

    expect(collected).toEqual(ids);
  });

  it('reconciles files already sitting in ARCHIVE_PATH from a previous run', async () => {
    // simulate an app that already archived a file in a past process, then
    // restarted with an empty in-memory index — the bytes are on disk, the
    // index doesn't know about them yet
    const preExistingDir = await mkdtemp(
      join(tmpdir(), 'files-e2e-preexisting-'),
    );
    await mkdir(join(preExistingDir, 'invoice'), { recursive: true });
    await writeFile(
      join(preExistingDir, 'invoice', 'legacy'),
      'from a previous run',
    );

    const { app, archiveDir } = await createTestApp({
      ARCHIVE_PATH: preExistingDir,
    });
    try {
      await request(app.getHttpServer())
        .head('/files/invoice/legacy')
        .expect(200)
        .expect('X-Storage-Tier', 'ARCHIVE');

      const getRes = await asBuffer(
        request(app.getHttpServer()).get('/files/invoice/legacy'),
      ).expect(200);
      expect(getRes.body.toString()).toBe('from a previous run');
    } finally {
      await app.close();
      await rm(preExistingDir, { recursive: true, force: true });
      await rm(archiveDir, { recursive: true, force: true });
    }
  });

  it('reconciles files already sitting on a disk-backed HotStorage from a previous run', async () => {
    // Proves reconciliation isn't archive-specific: HotStorage can also be
    // DiskFileStorage (e.g. rooted at NVMe), and files already there from a
    // past run must surface as HOT, not just ARCHIVE.
    const preExistingHotDir = await mkdtemp(
      join(tmpdir(), 'files-e2e-hot-preexisting-'),
    );
    await mkdir(join(preExistingHotDir, 'invoice'), { recursive: true });
    await writeFile(
      join(preExistingHotDir, 'invoice', 'legacy-hot'),
      'still hot',
    );

    const archiveDir = await mkdtemp(join(tmpdir(), 'files-e2e-'));
    const config: AppConfigShape = {
      ...loadConfig(BASE_ENV),
      ARCHIVE_PATH: archiveDir,
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue(config)
      .overrideProvider(HotStorage)
      .useValue(new DiskFileStorage(preExistingHotDir))
      .compile();

    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    try {
      await request(app.getHttpServer())
        .head('/files/invoice/legacy-hot')
        .expect(200)
        .expect('X-Storage-Tier', 'HOT');

      const getRes = await asBuffer(
        request(app.getHttpServer()).get('/files/invoice/legacy-hot'),
      ).expect(200);
      expect(getRes.body.toString()).toBe('still hot');
    } finally {
      await app.close();
      await rm(preExistingHotDir, { recursive: true, force: true });
      await rm(archiveDir, { recursive: true, force: true });
    }
  });

  it('archival: triggerImmediateSweep moves an expired file to ARCHIVE', async () => {
    const { app, archivalService, archiveDir } = await createTestApp({
      ARCHIVE_AFTER_MS: 1,
    });
    try {
      const server = app.getHttpServer();
      await request(server)
        .post('/files/invoice/expiring')
        .attach('file', Buffer.from('archive me'), 'a.txt')
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 5));
      await archivalService.triggerImmediateSweep();

      await request(server)
        .head('/files/invoice/expiring')
        .expect(200)
        .expect('X-Storage-Tier', 'ARCHIVE');
    } finally {
      await app.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  });
});

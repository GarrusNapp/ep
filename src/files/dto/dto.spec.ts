import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExistsBatchDto } from './exists-batch.dto.js';
import { FileParamsDto } from './file-params.dto.js';
import { ListFilesQueryDto } from './list-files.query.dto.js';

describe('FileParamsDto', () => {
  it('accepts safe type/id', async () => {
    const dto = plainToInstance(FileParamsDto, { type: 'invoice', id: 'a1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects path traversal in id', async () => {
    const dto = plainToInstance(FileParamsDto, { type: 'invoice', id: '..' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('ListFilesQueryDto', () => {
  it('limit is optional', async () => {
    const dto = plainToInstance(ListFilesQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects limit=0 and non-numeric values', async () => {
    expect(
      await validate(plainToInstance(ListFilesQueryDto, { limit: '0' })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(ListFilesQueryDto, { limit: 'abc' })),
    ).not.toHaveLength(0);
  });

  it('accepts a very large limit — the upper bound is controller policy, not DTO', async () => {
    const dto = plainToInstance(ListFilesQueryDto, { limit: '99999' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(99999);
  });
});

describe('ExistsBatchDto', () => {
  it('accepts a non-empty list of safe ids', async () => {
    const dto = plainToInstance(ExistsBatchDto, { ids: ['a1', 'b2'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an empty list', async () => {
    const dto = plainToInstance(ExistsBatchDto, { ids: [] });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects a list containing an unsafe id', async () => {
    const dto = plainToInstance(ExistsBatchDto, { ids: ['a1', '../etc'] });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

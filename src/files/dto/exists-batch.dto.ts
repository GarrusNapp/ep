import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray } from 'class-validator';
import type { SafeId } from '../../common/ids.js';
import { IsSafeId } from '../../common/validators/safe-id.validator.js';

// Deliberately without @ArrayMaxSize — the limit (EXISTS_BATCH_MAX) comes
// from config, so it's enforced in the controller (same as PAGE_SIZE_*).
export class ExistsBatchDto {
  @ApiProperty({
    description: 'Ids to check for existence (server-side upper bound applies)',
    type: [String],
    example: ['invoice-000039', 'b2'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsSafeId({ each: true })
  ids!: SafeId[];
}

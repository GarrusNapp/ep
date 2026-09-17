import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { SafeId } from '../../common/ids.js';

export class ListFilesQueryDto {
  @ApiPropertyOptional({
    description:
      'Opaque pagination cursor returned as `nextCursor` by a previous request',
  })
  @IsOptional()
  @IsString()
  cursor?: SafeId;

  @ApiPropertyOptional({
    description:
      'Max number of ids to return (server-side upper bound applies)',
    minimum: 1,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

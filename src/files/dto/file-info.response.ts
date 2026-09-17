import { ApiProperty } from '@nestjs/swagger';
import { SafeId } from '../../common/ids.js';
import { Tier } from '../index/file-index.js';

export class ListFilesResponse {
  @ApiProperty({ type: [String], description: 'File ids in this page' })
  ids!: SafeId[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cursor to pass as `cursor` to fetch the next page, or null if there is none',
  })
  nextCursor!: SafeId | null;

  @ApiProperty({ description: 'Whether more results exist beyond this page' })
  hasMore!: boolean;
}

export type ExistsResponse = Record<SafeId, Tier | null>;

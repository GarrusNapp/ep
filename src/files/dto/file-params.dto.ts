import { ApiProperty } from '@nestjs/swagger';
import type { FileType, SafeId } from '../../common/ids.js';
import { IsSafeId } from '../../common/validators/safe-id.validator.js';

export class FileParamsDto {
  @ApiProperty({
    description:
      'File type/category (must be one of the configured allowed types)',
    example: 'invoice',
  })
  @IsSafeId()
  type!: FileType;

  @ApiProperty({
    description:
      'File identifier — safe id: letters, digits, ".", "_", "-" only',
    example: 'a1',
  })
  @IsSafeId()
  id!: SafeId;
}

export class TypeParamsDto {
  @ApiProperty({
    description:
      'File type/category (must be one of the configured allowed types)',
    example: 'invoice',
  })
  @IsSafeId()
  type!: FileType;
}

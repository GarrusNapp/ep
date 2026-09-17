import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Head,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    Res,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiConflictResponse,
    ApiConsumes,
    ApiCreatedResponse,
    ApiHeader,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AppConfig } from '../config/app-config.js';
import { ExistsBatchDto } from './dto/exists-batch.dto.js';
import { ExistsResponse, ListFilesResponse } from './dto/file-info.response.js';
import { FileParamsDto, TypeParamsDto } from './dto/file-params.dto.js';
import { ListFilesQueryDto } from './dto/list-files.query.dto.js';
import { FilesService } from './files.service.js';

@ApiTags('files')
@Controller('files')
export class FilesController {
    constructor(
        private readonly files: FilesService,
        private readonly config: AppConfig,
    ) { }

    @Post(':type/_exists')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Check existence of a batch of ids for a given type' })
    @ApiParam({ name: 'type', description: 'File type/category', example: 'invoice' })
    @ApiOkResponse({
        description: 'Map of requested id to its storage tier, or null if it does not exist',
        schema: {
            type: 'object',
            additionalProperties: { type: 'string', enum: ['HOT', 'ARCHIVE', null], nullable: true },
            example: { a1: 'HOT', missing: null },
        },
    })
    @ApiBadRequestResponse({ description: 'Too many ids in the batch' })
    @ApiNotFoundResponse({ description: 'Unknown type' })
    async existsBatch(
        @Param() params: TypeParamsDto,
        @Body() body: ExistsBatchDto,
    ): Promise<ExistsResponse> {
        if (body.ids.length > this.config.EXISTS_BATCH_MAX) {
            throw new BadRequestException(
                `At most ${this.config.EXISTS_BATCH_MAX} ids per request`,
            );
        }
        return this.files.existsBatch(params.type, body.ids);
    }

    @Post(':type/:id')
    @HttpCode(HttpStatus.CREATED)
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
    @ApiOperation({ summary: 'Upload a new file (fails if the id already exists)' })
    @ApiParam({ name: 'type', description: 'File type/category', example: 'invoice' })
    @ApiParam({ name: 'id', description: 'File identifier', example: 'a1' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    @ApiCreatedResponse({ description: 'File stored successfully' })
    @ApiBadRequestResponse({ description: 'Missing/empty file, or file exceeds the size limit' })
    @ApiNotFoundResponse({ description: 'Unknown type' })
    @ApiConflictResponse({ description: 'A file with this type/id already exists' })
    async create(
        @Param() params: FileParamsDto,
        @UploadedFile() file: Express.Multer.File | undefined,
    ): Promise<void> {
        if (!file || file.buffer.length === 0) {
            throw new BadRequestException(
                'Required "file" field in multipart/form-data with non-empty content',
            );
        }
        if (file.buffer.length > this.config.MAX_FILE_SIZE) {
            throw new BadRequestException(
                `File exceeds the limit of ${this.config.MAX_FILE_SIZE} bytes`,
            );
        }

        await this.files.write(params.type, params.id, file.buffer);
    }

    @Get(':type/:id')
    @ApiOperation({ summary: 'Download a file' })
    @ApiParam({ name: 'type', description: 'File type/category', example: 'invoice' })
    @ApiParam({ name: 'id', description: 'File identifier', example: 'a1' })
    @ApiHeader({ name: 'X-Storage-Tier', description: 'Storage tier the file was served from (HOT or ARCHIVE)' })
    @ApiOkResponse({ description: 'Raw file bytes', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } })
    @ApiNotFoundResponse({ description: 'Unknown type, or file does not exist' })
    async get(
        @Param() params: FileParamsDto,
        @Res() res: Response,
    ): Promise<void> {
        const { data, entry } = await this.files.read(params.type, params.id);
        res.set({
            'X-Storage-Tier': entry.tier,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(data.length),
        });
        res.status(HttpStatus.OK).send(data);
    }

    @Head(':type/:id')
    @ApiOperation({ summary: "Check a file's metadata without fetching its bytes" })
    @ApiParam({ name: 'type', description: 'File type/category', example: 'invoice' })
    @ApiParam({ name: 'id', description: 'File identifier', example: 'a1' })
    @ApiHeader({ name: 'X-Storage-Tier', description: 'Storage tier the file is stored in (HOT or ARCHIVE)' })
    @ApiOkResponse({ description: 'File exists; metadata returned as headers' })
    @ApiNotFoundResponse({ description: 'Unknown type, or file does not exist' })
    async head(
        @Param() params: FileParamsDto,
        @Res() res: Response,
    ): Promise<void> {
        const entry = await this.files.head(params.type, params.id);
        res.set({
            'X-Storage-Tier': entry.tier,
            'Content-Length': String(entry.size),
        });
        res.status(HttpStatus.OK).end();
    }

    @Delete(':type/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a file' })
    @ApiParam({ name: 'type', description: 'File type/category', example: 'invoice' })
    @ApiParam({ name: 'id', description: 'File identifier', example: 'a1' })
    @ApiNoContentResponse({ description: 'File deleted' })
    @ApiNotFoundResponse({ description: 'Unknown type, or file does not exist' })
    @ApiConflictResponse({ description: 'File is currently being archived' })
    async delete(@Param() params: FileParamsDto): Promise<void> {
        await this.files.delete(params.type, params.id);
    }

    @Get(':type')
    @ApiOperation({ summary: 'List file ids for a given type (paginated)' })
    @ApiParam({ name: 'type', description: 'File type/category', example: 'invoice' })
    @ApiOkResponse({ description: 'A page of file ids', type: ListFilesResponse })
    @ApiNotFoundResponse({ description: 'Unknown type' })
    async list(
        @Param() params: TypeParamsDto,
        @Query() query: ListFilesQueryDto,
    ): Promise<ListFilesResponse> {
        const limit = Math.min(
            query.limit ?? this.config.PAGE_SIZE_DEFAULT,
            this.config.PAGE_SIZE_MAX,
        );
        const page = await this.files.list(params.type, query.cursor, limit);
        return {
            ids: page.items,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
        };
    }
}

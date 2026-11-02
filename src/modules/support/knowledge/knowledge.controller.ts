import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import {
  CreateKnowledgeArticleRequestDto,
  PreviewKnowledgeRequestDto,
  UpdateKnowledgeArticleRequestDto,
} from '../dto/knowledge-requests.dto';
import { KnowledgeService } from './knowledge.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** Admin Knowledge Base (plan §6.3). */
@ApiTags('support-knowledge')
@ApiBearerAuth()
@RequirePermission(PERMISSION.SUPPORT_KNOWLEDGE_MANAGE)
@Controller('admin/support/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @ApiOperation({ summary: 'Articles with their index status' })
  list(@Paginate() query: PaginateQuery) {
    return this.knowledge.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create an article; publishing it queues the index job' })
  create(@CurrentUser('id') adminId: string, @Body() dto: CreateKnowledgeArticleRequestDto) {
    return this.knowledge.create(dto, adminId);
  }

  @Post('reindex-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Queue every published article for re-embedding' })
  reindexAll(@CurrentUser('id') adminId: string) {
    return this.knowledge.reindexAll(adminId);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run retrieval against the KB without sending a chat message' })
  preview(@Body() dto: PreviewKnowledgeRequestDto) {
    return this.knowledge.preview(dto.query, {
      topK: dto.topK,
      locale: dto.locale,
      audience: dto.audience,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'One article with its chunks' })
  detail(@Param('id', ID) id: string) {
    return this.knowledge.detail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an article; a content change queues a reindex' })
  update(
    @CurrentUser('id') adminId: string,
    @Param('id', ID) id: string,
    @Body() dto: UpdateKnowledgeArticleRequestDto,
  ) {
    return this.knowledge.update(id, dto, adminId);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive an article and drop its chunks' })
  archive(@CurrentUser('id') adminId: string, @Param('id', ID) id: string) {
    return this.knowledge.archive(id, adminId);
  }

  @Post(':id/reindex')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rebuild one article’s chunks and embeddings' })
  reindex(@CurrentUser('id') adminId: string, @Param('id', ID) id: string) {
    return this.knowledge.reindex(id, adminId);
  }
}

/** AI provider and index health (plan §8.4); secrets never leave the server. */
@ApiTags('support-admin')
@ApiBearerAuth()
@RequirePermission(PERMISSION.SUPPORT_CASE_READ)
@Controller('admin/support/ai')
export class SupportAiHealthController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('health')
  @ApiOperation({ summary: 'AI mode, provider configuration and embedding index health' })
  health() {
    return this.knowledge.health();
  }
}

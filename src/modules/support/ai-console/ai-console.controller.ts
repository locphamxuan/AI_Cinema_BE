import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AiAnswerLogService } from './ai-answer-log.service';
import { AiPlaygroundService } from './ai-playground.service';
import { PreviewChatRequestDto, RateAiAnswerRequestDto } from './dto/ai-console.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** Admin AI console (2026-11-14): try the chatbot before members do, and review the answers it gave. */
@ApiTags('support-knowledge')
@ApiBearerAuth()
@RequirePermission(PERMISSION.SUPPORT_KNOWLEDGE_MANAGE)
@Controller('admin/support/ai')
export class AiConsoleController {
  constructor(
    private readonly playground: AiPlaygroundService,
    private readonly answers: AiAnswerLogService,
  ) {}

  @Post('preview-chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the AI a test question; returns its answer and the articles it used. Nothing is saved',
  })
  previewChat(@CurrentUser('id') adminId: string, @Body() dto: PreviewChatRequestDto) {
    return this.playground.previewChat(adminId, dto);
  }

  @Get('answers')
  @ApiOperation({ summary: 'Answers the AI gave members, with the question, sources and the Admin rating' })
  list(@Paginate() query: PaginateQuery) {
    return this.answers.list(query);
  }

  @Get('answers/summary')
  @ApiOperation({ summary: 'Counts of rated, unrated and handed-off AI answers, and the average member rating' })
  summary() {
    return this.answers.summary();
  }

  @Post('answers/:messageId/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark an AI answer helpful or not helpful (rating again overwrites)' })
  rate(
    @CurrentUser('id') adminId: string,
    @Param('messageId', ID) messageId: string,
    @Body() dto: RateAiAnswerRequestDto,
  ) {
    return this.answers.rate(messageId, dto.rating, dto.note, adminId);
  }
}

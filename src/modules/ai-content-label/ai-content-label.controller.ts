import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateAiContentLabelRequestDto } from './dto/create-ai-content-label.request.dto';
import { AiContentLabelService } from './ai-content-label.service';

@ApiTags('ai-content-labels')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class AiContentLabelController {
  constructor(private readonly aiContentLabelService: AiContentLabelService) {}

  @Post('episode-packages/:packageId/ai-content-labels')
  @RequirePermission(PERMISSION.EPISODE_REVIEW)
  async create(
    @Param('packageId') packageId: string,
    @Body() dto: CreateAiContentLabelRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.aiContentLabelService.create(packageId, dto, userId);
  }

  @Get('episode-packages/:packageId/ai-content-labels')
  async findAll(@Param('packageId') packageId: string) {
    return this.aiContentLabelService.findAll(packageId);
  }
}

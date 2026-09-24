import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateAiContentLabelRequestDto } from './dto/create-ai-content-label.request.dto';
import { AiContentLabelService } from './ai-content-label.service';
import { MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('ai-content-labels')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class AiContentLabelController {
  constructor(private readonly aiContentLabelService: AiContentLabelService) {}

  @Post('episode-packages/:packageId/ai-content-labels')
  @Roles(...REVIEWER_ROLES)
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

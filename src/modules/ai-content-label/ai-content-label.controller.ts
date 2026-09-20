import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateAiContentLabelRequestDto } from './dto/create-ai-content-label.request.dto';
import { AiContentLabelService } from './ai-content-label.service';

@ApiTags('ai-content-labels')
@Controller()
export class AiContentLabelController {
  constructor(private readonly aiContentLabelService: AiContentLabelService) {}

  @Post('episode-packages/:packageId/ai-content-labels')
  async create(@Param('packageId') packageId: string, @Body() dto: CreateAiContentLabelRequestDto) {
    return this.aiContentLabelService.create(packageId, dto);
  }

  @Get('episode-packages/:packageId/ai-content-labels')
  async findAll(@Param('packageId') packageId: string) {
    return this.aiContentLabelService.findAll(packageId);
  }
}

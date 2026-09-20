import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateGenerationJobRequestDto } from './dto/create-generation-job.request.dto';
import { CreateGeneratedAssetRequestDto } from './dto/create-generated-asset.request.dto';
import { CompleteGenerationJobRequestDto } from './dto/complete-generation-job.request.dto';
import { GenerationJobService } from './generation-job.service';

@ApiTags('generation-jobs')
@Controller()
export class GenerationJobController {
  constructor(private readonly generationJobService: GenerationJobService) {}

  @Post('production-plans/:planId/generation-jobs')
  async create(@Param('planId') planId: string, @Body() dto: CreateGenerationJobRequestDto) {
    return this.generationJobService.create(planId, dto);
  }

  @Get('production-plans/:planId/generation-jobs')
  async findAll(@Param('planId') planId: string) {
    return this.generationJobService.findAll(planId);
  }

  @Get('generation-jobs/:jobId')
  async findById(@Param('jobId') jobId: string) {
    return this.generationJobService.findById(jobId);
  }

  @Post('generation-jobs/:jobId/retry')
  async retry(@Param('jobId') jobId: string) {
    return this.generationJobService.retry(jobId);
  }

  @Post('generation-jobs/:jobId/cancel')
  async cancel(@Param('jobId') jobId: string) {
    return this.generationJobService.cancel(jobId);
  }

  @Post('generation-jobs/:jobId/generated-assets')
  async createGeneratedAsset(@Param('jobId') jobId: string, @Body() dto: CreateGeneratedAssetRequestDto) {
    return this.generationJobService.createGeneratedAsset(jobId, dto);
  }

  @Post('generation-jobs/:jobId/complete')
  async complete(@Param('jobId') jobId: string, @Body() dto: CompleteGenerationJobRequestDto) {
    return this.generationJobService.complete(jobId, dto);
  }
}

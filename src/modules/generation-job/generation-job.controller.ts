import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateGenerationJobRequestDto } from './dto/create-generation-job.request.dto';
import { CreateGeneratedAssetRequestDto } from './dto/create-generated-asset.request.dto';
import { CompleteGenerationJobRequestDto } from './dto/complete-generation-job.request.dto';
import { RetryGenerationJobRequestDto } from './dto/retry-generation-job.request.dto';
import { GenerationJobService } from './generation-job.service';

@ApiTags('generation-jobs')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class GenerationJobController {
  constructor(private readonly generationJobService: GenerationJobService) {}

  @Post('production-plans/:planId/generation-jobs')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async create(
    @Param('planId') planId: string,
    @Body() dto: CreateGenerationJobRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.generationJobService.create(planId, dto, userId);
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
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async retry(@Param('jobId') jobId: string, @Body() dto: RetryGenerationJobRequestDto) {
    return this.generationJobService.retry(jobId, dto);
  }

  @Post('generation-jobs/:jobId/run')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async run(@Param('jobId') jobId: string) {
    return this.generationJobService.run(jobId);
  }

  @Post('generation-jobs/:jobId/cancel')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async cancel(@Param('jobId') jobId: string) {
    return this.generationJobService.cancel(jobId);
  }

  @Delete('generation-jobs/:jobId')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async discard(@Param('jobId') jobId: string) {
    return this.generationJobService.discard(jobId);
  }

  @Post('generation-jobs/:jobId/generated-assets')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async createGeneratedAsset(@Param('jobId') jobId: string, @Body() dto: CreateGeneratedAssetRequestDto) {
    return this.generationJobService.createGeneratedAsset(jobId, dto);
  }

  @Post('generation-jobs/:jobId/complete')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async complete(@Param('jobId') jobId: string, @Body() dto: CompleteGenerationJobRequestDto) {
    return this.generationJobService.complete(jobId, dto);
  }
}

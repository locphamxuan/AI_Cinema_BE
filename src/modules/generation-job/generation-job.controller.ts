import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateGenerationJobRequestDto } from './dto/create-generation-job.request.dto';
import { CreateGeneratedAssetRequestDto } from './dto/create-generated-asset.request.dto';
import { CompleteGenerationJobRequestDto } from './dto/complete-generation-job.request.dto';
import { RetryGenerationJobRequestDto } from './dto/retry-generation-job.request.dto';
import { GenerationJobService } from './generation-job.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CREATOR_ROLES, MF1_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('generation-jobs')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class GenerationJobController {
  constructor(private readonly generationJobService: GenerationJobService) {}

  @Post('production-plans/:planId/generation-jobs')
  @Roles(...CREATOR_ROLES)
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
  @Roles(...CREATOR_ROLES)
  async retry(@Param('jobId') jobId: string, @Body() dto: RetryGenerationJobRequestDto) {
    return this.generationJobService.retry(jobId, dto);
  }

  @Post('generation-jobs/:jobId/run')
  @Roles(...CREATOR_ROLES)
  async run(@Param('jobId') jobId: string) {
    return this.generationJobService.run(jobId);
  }

  @Post('generation-jobs/:jobId/cancel')
  @Roles(...CREATOR_ROLES)
  async cancel(@Param('jobId') jobId: string) {
    return this.generationJobService.cancel(jobId);
  }

  @Post('generation-jobs/:jobId/generated-assets')
  @Roles(...CREATOR_ROLES)
  async createGeneratedAsset(@Param('jobId') jobId: string, @Body() dto: CreateGeneratedAssetRequestDto) {
    return this.generationJobService.createGeneratedAsset(jobId, dto);
  }

  @Post('generation-jobs/:jobId/complete')
  @Roles(...CREATOR_ROLES)
  async complete(@Param('jobId') jobId: string, @Body() dto: CompleteGenerationJobRequestDto) {
    return this.generationJobService.complete(jobId, dto);
  }
}

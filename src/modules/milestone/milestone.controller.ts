import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateMilestoneRequestDto } from './dto/create-milestone.request.dto';
import { UpdateMilestoneRequestDto } from './dto/update-milestone.request.dto';
import { MilestoneService } from './milestone.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';

@ApiTags('milestones')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class MilestoneController {
  constructor(private readonly milestoneService: MilestoneService) {}

  @Post('production-projects/:projectId/milestones')
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  async create(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: CreateMilestoneRequestDto) {
    return this.milestoneService.create(projectId, dto);
  }

  @Get('production-projects/:projectId/milestones')
  async findAll(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.milestoneService.findAll(projectId);
  }

  @Get('milestones/:milestoneId')
  async findById(@Param('milestoneId', ParseUUIDPipe) milestoneId: string) {
    return this.milestoneService.findById(milestoneId);
  }

  @Patch('milestones/:milestoneId')
  @RequirePermission(PERMISSION.MILESTONE_UPDATE)
  async update(
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.milestoneService.update(milestoneId, dto, user.role);
  }
}

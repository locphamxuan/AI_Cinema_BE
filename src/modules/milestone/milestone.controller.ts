import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateMilestoneRequestDto } from './dto/create-milestone.request.dto';
import { UpdateMilestoneRequestDto } from './dto/update-milestone.request.dto';
import { MilestoneService } from './milestone.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';

@ApiTags('milestones')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class MilestoneController {
  constructor(private readonly milestoneService: MilestoneService) {}

  @Post('production-projects/:projectId/milestones')
  @Roles(...REVIEWER_ROLES)
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
  async update(
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.milestoneService.update(milestoneId, dto, user.role);
  }
}

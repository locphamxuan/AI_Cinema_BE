import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateMilestoneRequestDto } from './dto/create-milestone.request.dto';
import { UpdateMilestoneRequestDto } from './dto/update-milestone.request.dto';
import { MilestoneService } from './milestone.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('milestones')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class MilestoneController {
  constructor(private readonly milestoneService: MilestoneService) {}

  @Post('production-projects/:projectId/milestones')
  @Roles(...REVIEWER_ROLES)
  async create(@Param('projectId') projectId: string, @Body() dto: CreateMilestoneRequestDto) {
    return this.milestoneService.create(projectId, dto);
  }

  @Get('production-projects/:projectId/milestones')
  async findAll(@Param('projectId') projectId: string) {
    return this.milestoneService.findAll(projectId);
  }

  @Get('milestones/:milestoneId')
  async findById(@Param('milestoneId') milestoneId: string) {
    return this.milestoneService.findById(milestoneId);
  }

  @Patch('milestones/:milestoneId')
  async update(@Param('milestoneId') milestoneId: string, @Body() dto: UpdateMilestoneRequestDto) {
    return this.milestoneService.update(milestoneId, dto);
  }
}

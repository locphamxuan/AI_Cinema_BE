import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateMilestoneRequestDto } from './dto/create-milestone.request.dto';
import { UpdateMilestoneRequestDto } from './dto/update-milestone.request.dto';
import { MilestoneService } from './milestone.service';

@ApiTags('milestones')
@Controller()
export class MilestoneController {
  constructor(private readonly milestoneService: MilestoneService) {}

  @Post('production-projects/:projectId/milestones')
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

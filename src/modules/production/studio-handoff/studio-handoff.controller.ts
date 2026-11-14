import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ChangeStudioRequestDto } from './dto/studio-handoff.request.dto';
import { HandoffMaterialService } from './material/handoff-material.service';
import { StudioHandoffService } from './studio-handoff.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('studio-handoff')
@ApiBearerAuth()
@Controller('projects/:projectId')
export class StudioHandoffController {
  constructor(
    private readonly handoffs: StudioHandoffService,
    private readonly materials: HandoffMaterialService,
  ) {}

  @Post('studio-change')
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @ApiOperation({
    summary: 'Admin: move the project or a season to another studio, with the reason; a new brief is emailed',
  })
  changeStudio(
    @Param('projectId', ID) projectId: string,
    @Body() dto: ChangeStudioRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.handoffs.changeStudio(projectId, dto, user);
  }

  @Get('handoffs')
  @ApiOperation({ summary: 'Studio timeline: every hand-off with its materials and milestone events, newest first' })
  history(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.handoffs.history(projectId, user);
  }

  @Get('handoffs/:handoffId/brief')
  @ApiOperation({ summary: 'Download the brief PDF sent with a hand-off' })
  brief(
    @Param('projectId', ID) projectId: string,
    @Param('handoffId', ID) handoffId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.handoffs.briefFile(projectId, handoffId, user);
  }

  @Get('handoffs/:handoffId/materials/:materialId/content')
  @ApiOperation({ summary: 'Download a file an older hand-off sent (scripts are no longer emailed)' })
  material(
    @Param('projectId', ID) projectId: string,
    @Param('handoffId', ID) handoffId: string,
    @Param('materialId', ID) materialId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.materials.download(projectId, handoffId, materialId, user);
  }
}

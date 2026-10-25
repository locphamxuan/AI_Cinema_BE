import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ChangeStudioRequestDto, HandOffRequestDto, UpdateMilestoneRequestDto } from './dto/studio-handoff.request.dto';
import {
  HandoffMaterialService,
  MATERIAL_MAX_BYTES,
  MATERIAL_MAX_FILES,
  type MaterialUploads,
} from './material/handoff-material.service';
import { MilestoneService } from './milestone/milestone.service';
import { StudioHandoffService } from './studio-handoff.service';

const ID = new ParseUUIDPipe({ version: '4' });
const MATERIAL_FIELDS = FileFieldsInterceptor(
  [
    { name: 'scripts', maxCount: MATERIAL_MAX_FILES },
    { name: 'references', maxCount: MATERIAL_MAX_FILES },
  ],
  { limits: { fileSize: MATERIAL_MAX_BYTES, files: MATERIAL_MAX_FILES } },
);

@ApiTags('studio-handoff')
@ApiBearerAuth()
@Controller('projects/:movieId')
export class StudioHandoffController {
  constructor(
    private readonly handoffs: StudioHandoffService,
    private readonly milestones: MilestoneService,
    private readonly materials: HandoffMaterialService,
  ) {}

  @Post('handoff')
  @RequirePermission(PERMISSION.STUDIO_HANDOFF)
  @UseInterceptors(MATERIAL_FIELDS)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Hand the project or one season to a studio: brief PDF, scripts and references by email; IN_PRODUCTION (steps 3–4)',
  })
  handOff(
    @Param('movieId', ID) movieId: string,
    @Body() dto: HandOffRequestDto,
    @UploadedFiles() files: MaterialUploads,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.handoffs.handOff(movieId, dto, files ?? {}, user);
  }

  @Post('studio-change')
  @RequirePermission(PERMISSION.STUDIO_HANDOFF)
  @UseInterceptors(MATERIAL_FIELDS)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Move the project or a season to another studio, with the reason; a new brief is sent' })
  changeStudio(
    @Param('movieId', ID) movieId: string,
    @Body() dto: ChangeStudioRequestDto,
    @UploadedFiles() files: MaterialUploads,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.handoffs.changeStudio(movieId, dto, files ?? {}, user);
  }

  @Get('handoffs')
  @ApiOperation({ summary: 'Studio timeline: every hand-off with its materials and milestone events, newest first' })
  history(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.handoffs.history(movieId, user);
  }

  @Patch('handoffs/:handoffId/milestone')
  @RequirePermission(PERMISSION.STUDIO_HANDOFF)
  @ApiOperation({ summary: 'Move the studio milestone; DELIVERED needs the uploaded Submission (BR-58)' })
  updateMilestone(
    @Param('movieId', ID) movieId: string,
    @Param('handoffId', ID) handoffId: string,
    @Body() dto: UpdateMilestoneRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.milestones.update(movieId, handoffId, dto, user);
  }

  @Get('handoffs/:handoffId/brief')
  @ApiOperation({ summary: 'Download the brief PDF sent with a hand-off' })
  brief(
    @Param('movieId', ID) movieId: string,
    @Param('handoffId', ID) handoffId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.handoffs.briefFile(movieId, handoffId, user);
  }

  @Get('handoffs/:handoffId/materials/:materialId/content')
  @ApiOperation({ summary: 'Download a script or reference file sent with a hand-off' })
  material(
    @Param('movieId', ID) movieId: string,
    @Param('handoffId', ID) handoffId: string,
    @Param('materialId', ID) materialId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.materials.download(movieId, handoffId, materialId, user);
  }
}

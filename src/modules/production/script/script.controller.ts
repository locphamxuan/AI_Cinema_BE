import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { FinalReviewScriptRequestDto, ReviewScriptRequestDto, SubmitScriptRequestDto } from './dto/script.request.dto';
import { ScriptService } from './script.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** MF-1 §2: the script of a project — Creator writes, Reviewer reviews, Admin approves the Final Script. */
@ApiTags('scripts')
@ApiBearerAuth()
@Controller('projects/:projectId/script')
export class ScriptController {
  constructor(private readonly scripts: ScriptService) {}

  @Get()
  @ApiOperation({ summary: 'The script with every version and review (null before the first submission)' })
  get(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.scripts.get(projectId, user);
  }

  @Post('versions')
  @RequirePermission(PERMISSION.SCRIPT_WRITE)
  @ApiOperation({ summary: 'Lead Creator: submit a new version of the script to the Reviewer' })
  submit(
    @Param('projectId', ID) projectId: string,
    @Body() dto: SubmitScriptRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scripts.submit(projectId, dto, user);
  }

  @Post('review')
  @RequirePermission(PERMISSION.CONTENT_REVIEW)
  @ApiOperation({ summary: 'Reviewer: pass the submitted script on to the Admin, or send it back' })
  review(
    @Param('projectId', ID) projectId: string,
    @Body() dto: ReviewScriptRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scripts.review(projectId, dto, user);
  }

  @Post('final-review')
  @RequirePermission(PERMISSION.SCRIPT_APPROVE)
  @ApiOperation({ summary: 'Admin: approve the Final Script (sends the studio its contract) or send it back' })
  finalReview(
    @Param('projectId', ID) projectId: string,
    @Body() dto: FinalReviewScriptRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scripts.finalReview(projectId, dto, user);
  }
}

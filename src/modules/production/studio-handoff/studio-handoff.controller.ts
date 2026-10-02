import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ChangeStudioRequestDto, HandOffRequestDto } from './dto/studio-handoff.request.dto';
import { StudioHandoffService } from './studio-handoff.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('studio-handoff')
@ApiBearerAuth()
@Controller('projects/:movieId')
export class StudioHandoffController {
  constructor(private readonly handoffs: StudioHandoffService) {}

  @Post('handoff')
  @RequirePermission(PERMISSION.STUDIO_HANDOFF)
  @ApiOperation({
    summary:
      'Hand the project to a studio, due on the Reviewer deadlines: brief PDF and email; IN_PRODUCTION (steps 3–4)',
  })
  handOff(
    @Param('movieId', ID) movieId: string,
    @Body() dto: HandOffRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.handoffs.handOff(movieId, dto, user);
  }

  @Post('studio-change')
  @RequirePermission(PERMISSION.STUDIO_HANDOFF)
  @ApiOperation({ summary: 'Move the project to another studio, with the reason; a new brief is sent' })
  changeStudio(
    @Param('movieId', ID) movieId: string,
    @Body() dto: ChangeStudioRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.handoffs.changeStudio(movieId, dto, user);
  }

  @Post('handoffs/portal-link')
  @RequirePermission(PERMISSION.STUDIO_HANDOFF)
  @ApiOperation({ summary: 'Email the current studio a new portal link; the previous link stops working' })
  resendPortalLink(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.handoffs.resendPortalLink(movieId, user);
  }

  @Get('handoffs')
  @ApiOperation({ summary: 'Every hand-off and studio change, newest first, with the email status' })
  history(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.handoffs.history(movieId, user);
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
}

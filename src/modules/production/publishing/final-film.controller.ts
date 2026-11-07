import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ReasonRequestDto } from 'src/modules/production/movie-project/dto/project-actions.request.dto';
import { FinalFilmService } from './final-film.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** MF-1 §5–6: the Reviewer confirms the Final Film, the Admin publishes it or sends it back via the Reviewer. */
@ApiTags('publishing')
@ApiBearerAuth()
@Controller('episodes/:episodeId')
export class FinalFilmController {
  constructor(private readonly finalFilm: FinalFilmService) {}

  @Post('final-confirmation')
  @HttpCode(200)
  @RequirePermission(PERMISSION.CONTENT_REVIEW)
  @ApiOperation({ summary: 'Reviewer: confirm the checked, labeled and priced version as the Final Film' })
  confirm(@Param('episodeId', ID) episodeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.finalFilm.confirm(episodeId, user);
  }

  @Post('final-rejection')
  @HttpCode(200)
  @RequirePermission(PERMISSION.EPISODE_PUBLISH)
  @ApiOperation({ summary: 'Admin: send the Final Film back to the Reviewer, who coordinates the fix with the studio' })
  reject(
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: ReasonRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.finalFilm.reject(episodeId, dto.reason, user);
  }
}

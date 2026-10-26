import { Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { SavedMovieService } from './saved-movie.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('saved-movies')
export class SavedMovieController {
  constructor(private readonly saved: SavedMovieService) {}

  @Get()
  @ApiOperation({ summary: 'Movies the caller saved to watch later, newest first' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.saved.list(user.id);
  }

  @Get(':movieId')
  @ApiOperation({ summary: 'Whether the caller saved this movie' })
  isSaved(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.saved.isSaved(movieId, user.id);
  }

  @Put(':movieId')
  @ApiOperation({ summary: 'Save the movie to watch later' })
  save(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.saved.save(movieId, user.id);
  }

  @Delete(':movieId')
  @ApiOperation({ summary: 'Take the movie off the saved list' })
  unsave(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.saved.unsave(movieId, user.id);
  }
}

import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { FilmReportService } from './film-report.service';

@ApiTags('admin-films')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PROJECT_READ_ALL)
@Controller('admin/films')
export class FilmReportController {
  constructor(private readonly report: FilmReportService) {}

  @Get('genres')
  @ApiOperation({ summary: 'Genres with movies on the platform, for one tab each' })
  genres() {
    return this.report.genres();
  }

  @Get()
  @ApiQuery({ name: 'genreId', required: false })
  @ApiOperation({ summary: 'Movies on the platform with hearts, plays and Coin earned, per movie and per episode' })
  movies(@Query('genreId', new ParseUUIDPipe({ optional: true })) genreId?: string) {
    return this.report.movies(genreId);
  }
}

import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { FilmSentRequestDto } from './film-sent.request.dto';
import { FilmSentService } from './film-sent.service';

/** Called by the Studio Web (a separate site), so it carries a shared token instead of a user session. */
@ApiTags('studio-handoff')
@Controller('studio-inbound')
export class FilmSentController {
  constructor(
    private readonly filmSent: FilmSentService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('film-sent')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'x-studio-token', description: 'STUDIO_WEBHOOK_TOKEN shared with the Studio Web' })
  @ApiOperation({ summary: 'The studio mailed a prepared film to the Creator: notify the Creator and Reviewer' })
  record(@Headers('x-studio-token') token: string | undefined, @Body() dto: FilmSentRequestDto) {
    this.assertToken(token);
    return this.filmSent.record(dto);
  }

  private assertToken(token: string | undefined) {
    const expected = this.config.studio.webhookToken;
    if (!expected) throw new ServiceUnavailableException('The studio inbound channel is not configured');
    const given = Buffer.from(token ?? '');
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new UnauthorizedException('Invalid studio token');
    }
  }
}

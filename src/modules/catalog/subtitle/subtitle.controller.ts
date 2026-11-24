import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { VISIBLE_EPISODE } from '../episode-visibility';

/** WebVTT of a released episode, read from storage by the API so any player can load it. */
@ApiTags('catalog')
@Public()
@Controller('subtitles')
export class SubtitleController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':subtitleId')
  @Header('Content-Type', 'text/vtt; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'A subtitle track (WebVTT) of a released episode' })
  async vtt(@Param('subtitleId', new ParseUUIDPipe({ version: '4' })) subtitleId: string): Promise<string> {
    const subtitle = await this.prisma.mediaSubtitle.findFirst({
      where: { id: subtitleId, mediaAsset: { approvedInEpisode: { ...VISIBLE_EPISODE, revisionStartedAt: null } } },
      select: { fileUrl: true },
    });
    if (!subtitle) throw new NotFoundException('Subtitle not found');
    return readSubtitleFile(subtitle.fileUrl);
  }
}

/** How long the storage may take to hand over a WebVTT file before the player is told it is unavailable. */
const SUBTITLE_FETCH_TIMEOUT_MS = 10_000;

/** Reads the stored WebVTT; a storage that is down, slow or missing the file answers 404, never a 500 or a hang. */
export async function readSubtitleFile(fileUrl: string, fetcher: typeof fetch = fetch): Promise<string> {
  const unavailable = () =>
    new NotFoundException({
      message: 'Subtitle file is not available',
      details: { reason: 'SUBTITLE_FILE_UNAVAILABLE' },
    });
  try {
    const response = await fetcher(fileUrl, { signal: AbortSignal.timeout(SUBTITLE_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw unavailable();
    return await response.text();
  } catch (error) {
    if (error instanceof NotFoundException) throw error;
    throw unavailable();
  }
}

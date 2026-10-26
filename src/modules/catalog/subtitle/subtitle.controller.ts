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
    const response = await fetch(subtitle.fileUrl);
    if (!response.ok) throw new NotFoundException('Subtitle file is not available');
    return response.text();
  }
}

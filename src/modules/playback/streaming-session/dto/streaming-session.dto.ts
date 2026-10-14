import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Main Flow 3, step 11: ask for a streaming session for an episode access was granted for. */
export class CreateStreamingSessionRequestDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33', description: 'Episode to play' })
  @IsUUID(4)
  episodeId: string;
}

/** What starting (or reusing) a streaming session hands back to the player. */
export class StreamingSessionViewDto {
  @ApiProperty({ example: 'b21c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  sessionId: string;

  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  episodeId: string;

  @ApiProperty({ example: '3a71f0d4-9c22-4c6b-8f31-1a2b3c4d5e6f' })
  movieId: string;

  @ApiProperty({ example: 'PLAN', description: 'How the playback access was granted' })
  accessType: string;

  @ApiPropertyOptional({ example: 'MONTHLY', description: 'Present when accessType is PLAN' })
  planCode?: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiProperty({ example: 0, description: 'Where playback starts; resume comes in a later phase' })
  startPositionSeconds: number;

  @ApiProperty({
    example: {
      masterUrl: 'https://cdn.aicinema.example/public/hls/<assetId>/master.m3u8',
      qualities: ['360p', '720p', '1080p'],
      durationSeconds: 1320,
    },
    description: 'Direct origin URL in phase 1; replaced by the signed CDN URL in phase 2',
  })
  stream: { masterUrl: string; qualities: string[]; durationSeconds: number | null };

  @ApiProperty({ example: [] })
  subtitles: { language: string; url: string; isDefault: boolean }[];

  @ApiProperty({
    example: null,
    description: 'On-screen AI-content notice required by the AI Law; null only when no label row exists',
  })
  aiLabel: { type: string; text: string; displayLocation: string | null } | null;

  @ApiPropertyOptional({ example: true, description: 'The same tap sent twice reused the live session' })
  reused?: boolean;
}

import { EPISODE_AVAILABILITY, type EpisodeAvailability } from 'src/modules/catalog/episode-visibility';
import {
  ACCESS_SOURCE,
  ACTOR_TYPE,
  ACCESS_METHOD,
  NEXT_ACTION,
} from 'src/modules/episode-access/access-decision/constants/access.constants';
import type {
  AccessSourceName,
  ActorType,
  AccessMethod,
  NextAction,
} from 'src/modules/episode-access/access-decision/constants/access.constants';
import { AccessRequired } from './access-required.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccessDecisionDto {
  @ApiProperty({
    example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33',
  })
  episodeId: string;

  @ApiPropertyOptional({
    example: '3a71f0d4-9c22-4c6b-8f31-1a2b3c4d5e6f',
  })
  movieId?: string;

  @ApiProperty({
    enum: EPISODE_AVAILABILITY,
    example: 'AVAILABLE',
    description: 'Whether the episode can be played right now; anything but AVAILABLE is never handed off',
  })
  availability: EpisodeAvailability;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'The maintenance notice to show when availability is not AVAILABLE',
  })
  notice: string | null;

  @ApiProperty({ example: false })
  accessGranted: boolean;

  @ApiProperty({
    enum: ACCESS_SOURCE,
    example: 'PLAN',
  })
  source: AccessSourceName;

  @ApiProperty({
    enum: ACTOR_TYPE,
    example: 'MEMBER',
  })
  actorType: ActorType;

  @ApiPropertyOptional({
    example: 'MONTHLY',
    description: 'The plan that grants the access',
  })
  planCode?: string;

  @ApiProperty({
    enum: ACCESS_METHOD,
    isArray: true,
    example: ['MONTHLY_PLAN', 'UNLOCK_EPISODE'],
  })
  accessMethods: AccessMethod[];

  @ApiProperty({ type: AccessRequired })
  required: AccessRequired;

  /**
   * @deprecated The raw origin URL plays without Main Flow 3 — no ads, stream limit or progress.
   * Players move to POST /playback/sessions (signed stream URL, ad schedule, heartbeat); this field
   * goes once the web and mobile clients have switched.
   */
  @ApiPropertyOptional({
    example: 'https://cdn.example.com/public/episodes/1/master.m3u8',
    deprecated: true,
    description:
      'Deprecated: open POST /playback/sessions instead, which applies ads, the stream limit and progress. Only present when access is granted.',
  })
  streamUrl?: string;

  @ApiProperty({
    enum: NEXT_ACTION,
    example: 'HANDOFF_TO_PLAYBACK',
  })
  nextAction: NextAction;
}

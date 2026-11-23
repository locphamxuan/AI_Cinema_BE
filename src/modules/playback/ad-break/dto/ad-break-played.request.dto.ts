import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_POSITION_SECONDS } from 'src/modules/playback/watch-progress/dto/position-limit';

/**
 * The player pauses the episode at a cue and reports where the playhead actually is.
 * The server compares it with the scheduled cue: an impression is money, so a claim
 * from the opening credits must not be able to bill every break in the episode.
 */
export class AdBreakPlayedRequestDto {
  @ApiProperty({
    example: 460,
    description:
      'Content playhead in seconds when the ad break was triggered. Must be within the cue tolerance; the server rejects a position that has not reached the cue or has already passed it.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_POSITION_SECONDS)
  positionSeconds: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { MAX_POSITION_SECONDS } from 'src/modules/playback/watch-progress/dto/position-limit';
import { MAX_AD_SLOTS_PER_EPISODE } from '../ad-limits';

class EpisodeAdSlotInputDto {
  @ApiProperty({ example: 420, description: 'Second of the episode where the ad is inserted' })
  @IsInt()
  @Min(1)
  @Max(MAX_POSITION_SECONDS)
  positionSeconds: number;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Ad to play at this cue; empty = random draw among the ACTIVE ads',
  })
  @IsOptional()
  @IsUUID('4')
  adId?: string | null;
}

/** The whole set of cues of one episode; the array length is how many times ads are inserted. */
export class SetEpisodeAdSlotsRequestDto {
  @ApiProperty({
    type: [EpisodeAdSlotInputDto],
    maxItems: MAX_AD_SLOTS_PER_EPISODE,
    description: 'Replaces every cue of the episode; an empty list goes back to random cues',
  })
  @IsArray()
  @ArrayMaxSize(MAX_AD_SLOTS_PER_EPISODE)
  @ValidateNested({ each: true })
  @Type(() => EpisodeAdSlotInputDto)
  slots: EpisodeAdSlotInputDto[];
}

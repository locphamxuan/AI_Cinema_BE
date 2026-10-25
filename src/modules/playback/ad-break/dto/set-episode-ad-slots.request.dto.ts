import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { MAX_AD_SLOTS_PER_EPISODE } from '../ad-limits';

export class EpisodeAdSlotInputDto {
  @ApiProperty({ example: 420, description: 'Second of the episode where the ad is inserted' })
  @IsInt()
  @Min(1)
  positionSeconds: number;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Ad to play at this cue; empty = weighted draw among the valid ads',
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

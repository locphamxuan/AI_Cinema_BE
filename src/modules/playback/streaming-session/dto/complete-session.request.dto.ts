import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_POSITION_SECONDS } from 'src/modules/playback/watch-progress/dto/position-limit';

/**
 * The player reports that playback ended. The position is only a hint for where it
 * ended: the server decides completion against the completion threshold (P3-3).
 */
export class CompleteSessionRequestDto {
  @ApiPropertyOptional({
    example: 1180,
    description:
      'Final position. Defaults to the last saved heartbeat position; the server still decides whether it counts as completed.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_POSITION_SECONDS)
  positionSeconds?: number;
}

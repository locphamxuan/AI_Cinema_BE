import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_POSITION_SECONDS } from './position-limit';

/** Leaving the player: persist where the viewer stopped. */
export class StopSessionRequestDto {
  @ApiProperty({ example: 320 })
  @IsInt()
  @Min(0)
  @Max(MAX_POSITION_SECONDS)
  positionSeconds: number;
}

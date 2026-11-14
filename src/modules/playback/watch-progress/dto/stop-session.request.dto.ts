import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** Leaving the player: persist where the viewer stopped. */
export class StopSessionRequestDto {
  @ApiProperty({ example: 320 })
  @IsInt()
  @Min(0)
  positionSeconds: number;
}

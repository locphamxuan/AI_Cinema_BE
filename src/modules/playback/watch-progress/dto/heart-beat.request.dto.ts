import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min, IsOptional } from 'class-validator';

/** Player heartbeat, every 10–15s: where it is and how much was watched since the last beat. */
export class HeartbeatRequestDto {
  @ApiProperty({ example: 320 })
  @IsInt()
  @Min(0)
  positionSeconds: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  watchedSeconds?: number;
}

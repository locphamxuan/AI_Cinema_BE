import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_POSITION_SECONDS } from './position-limit';

/** Player heartbeat, every 10–15s: where it is and how much was watched since the last beat. */
export class HeartbeatRequestDto {
  @ApiProperty({ example: 320 })
  @IsInt()
  @Min(0)
  @Max(MAX_POSITION_SECONDS)
  positionSeconds: number;

  /** Advisory: the server credits its own measured window and uses this only to clamp it down. */
  @ApiPropertyOptional({
    example: 12,
    description: 'Watch time since the last beat; may only lower the server-measured credit, never raise it.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_POSITION_SECONDS)
  watchedSeconds?: number;
}

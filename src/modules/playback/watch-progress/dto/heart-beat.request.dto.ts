import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min, IsOptional } from 'class-validator';

/** Player heartbeat, every 10–15s: where it is and how much was watched since the last beat. */
export class HeartbeatRequestDto {
  @ApiProperty({ example: 320 })
  @IsInt()
  @Min(0)
  positionSeconds: number;

  /** Advisory: the server credits its own measured window and uses this only to clamp it down. */
  @ApiPropertyOptional({
    example: 12,
    description: 'Watch time since the last beat; may only lower the server-measured credit, never raise it.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  watchedSeconds?: number;
}

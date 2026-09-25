import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class CreateProjectEpisodeRequestDto {
  @ApiProperty({ example: 1, description: 'Season the episode belongs to (1-based, seasons must be consecutive).' })
  @IsInt()
  @Min(1)
  seasonNumber: number;

  @ApiProperty({
    example: 1800,
    description:
      "Duration (seconds) the Reviewer allots this episode — the baseline its plan's duration is reviewed against.",
  })
  @IsInt()
  @Min(1)
  targetDurationSeconds: number;
}

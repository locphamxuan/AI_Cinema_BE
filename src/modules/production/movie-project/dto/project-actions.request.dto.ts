import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_TARGET_DURATION_SECONDS } from './create-movie-project.request.dto';

export class AssignCreatorRequestDto {
  @ApiProperty({ description: 'Active Content Creator account that will run the project.' })
  @IsUUID('4')
  creatorId: string;
}

export class ReasonRequestDto {
  @ApiProperty({ example: 'The studio closed down and no replacement fits the budget.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
}

export class UpdateEpisodeRequestDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  synopsis?: string;

  @ApiPropertyOptional({ description: 'Can change until the episode is approved (BR-31).' })
  @IsInt()
  @Min(1)
  @Max(MAX_TARGET_DURATION_SECONDS)
  @IsOptional()
  targetDurationSeconds?: number;
}

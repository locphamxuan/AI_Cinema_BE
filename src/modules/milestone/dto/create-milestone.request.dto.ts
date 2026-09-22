import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMilestoneRequestDto {
  @ApiProperty({ example: 'Script hoàn thành', description: 'Title of the milestone.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'Hoàn thiện kịch bản cho cả 5 tập.', description: 'Description of the milestone.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00.000Z', description: 'Target date of the milestone (ISO-8601).' })
  @IsDateString()
  @IsOptional()
  targetDate?: string;
}
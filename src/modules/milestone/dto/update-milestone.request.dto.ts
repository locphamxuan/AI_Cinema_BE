import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MilestoneStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMilestoneRequestDto {
  @ApiPropertyOptional({ example: 'Script hoàn thành (v2)', description: 'Title of the milestone.' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Description of the milestone.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00.000Z', description: 'Target date of the milestone (ISO-8601).' })
  @IsDateString()
  @IsOptional()
  targetDate?: string;

  @ApiPropertyOptional({ example: 'COMPLETED', description: 'Status of the milestone.', enum: MilestoneStatus })
  @IsEnum(MilestoneStatus)
  @IsOptional()
  status?: MilestoneStatus;

  @ApiPropertyOptional({ example: 'Đã duyệt kịch bản cho cả 5 tập', description: 'Result/outcome of the milestone.' })
  @IsString()
  @IsOptional()
  resultText?: string;
}
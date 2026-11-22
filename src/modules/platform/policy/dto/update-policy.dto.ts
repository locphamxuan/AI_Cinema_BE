import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsJSON, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { PolicyType } from '@prisma/client';
import { Type } from 'class-transformer';

export class UpdatePolicyDto {
  @ApiPropertyOptional({ example: 'AI-Generated Content Labeling Policy' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ enum: PolicyType })
  @IsOptional()
  @IsEnum(PolicyType)
  type?: PolicyType;

  @ApiPropertyOptional({ example: '1.1.0' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  version?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentReference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsJSON()
  content?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;
}

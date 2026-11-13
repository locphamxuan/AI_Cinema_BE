import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportAudience } from '@prisma/client';
import { IsString, MinLength, MaxLength, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';

export class PreviewKnowledgeRequestDto {
  @ApiProperty({ example: 'Làm sao để hủy gói tháng?' })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  query: string;

  @ApiPropertyOptional({ default: 'vi' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ enum: SupportAudience, default: SupportAudience.MEMBER })
  @IsOptional()
  @IsEnum(SupportAudience)
  audience?: SupportAudience;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;
}

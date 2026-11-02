import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { KnowledgeArticleStatus, KnowledgeSource, SupportAudience } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateKnowledgeArticleRequestDto {
  @ApiProperty({ example: 'Chính sách Coin thưởng' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'chinh-sach-coin-thuong' })
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase words separated by hyphens' })
  slug: string;

  @ApiProperty({ example: 'Policy' })
  @IsString()
  @MaxLength(100)
  category: string;

  @ApiPropertyOptional({ enum: SupportAudience, default: SupportAudience.MEMBER })
  @IsOptional()
  @IsEnum(SupportAudience)
  audience?: SupportAudience;

  @ApiPropertyOptional({ default: 'vi' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiProperty({ description: 'Markdown content; dynamic values such as the Coin rate stay out of it' })
  @IsString()
  @MinLength(1)
  contentMarkdown: string;

  @ApiPropertyOptional({ enum: KnowledgeSource, default: KnowledgeSource.MANUAL })
  @IsOptional()
  @IsEnum(KnowledgeSource)
  source?: KnowledgeSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceRef?: string;

  @ApiPropertyOptional({ enum: KnowledgeArticleStatus, default: KnowledgeArticleStatus.DRAFT })
  @IsOptional()
  @IsEnum(KnowledgeArticleStatus)
  status?: KnowledgeArticleStatus;
}

export class UpdateKnowledgeArticleRequestDto extends PartialType(CreateKnowledgeArticleRequestDto) {}

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

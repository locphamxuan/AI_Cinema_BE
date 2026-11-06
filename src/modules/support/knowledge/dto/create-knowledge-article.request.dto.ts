import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportAudience, KnowledgeSource, KnowledgeArticleStatus } from '@prisma/client';
import { IsString, MinLength, MaxLength, Matches, IsOptional, IsEnum } from 'class-validator';

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

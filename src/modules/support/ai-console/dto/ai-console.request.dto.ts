import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportAiFeedback, SupportAudience } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PlaygroundTurnDto {
  @ApiProperty({ enum: ['MEMBER', 'AI'] })
  @IsIn(['MEMBER', 'AI'])
  role: 'MEMBER' | 'AI';

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  content: string;
}

export class PreviewChatRequestDto {
  @ApiProperty({ example: 'Làm sao để hủy gói tháng?' })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  question: string;

  @ApiPropertyOptional({ enum: SupportAudience, default: SupportAudience.MEMBER })
  @IsOptional()
  @IsEnum(SupportAudience)
  audience?: SupportAudience;

  @ApiPropertyOptional({ default: 'vi' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ type: [PlaygroundTurnDto], description: 'Earlier turns of this test chat, oldest first' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PlaygroundTurnDto)
  history?: PlaygroundTurnDto[];
}

export class RateAiAnswerRequestDto {
  @ApiProperty({ enum: SupportAiFeedback })
  @IsEnum(SupportAiFeedback)
  rating: SupportAiFeedback;

  @ApiPropertyOptional({ maxLength: 2000, description: 'What the answer missed, e.g. which article to add' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

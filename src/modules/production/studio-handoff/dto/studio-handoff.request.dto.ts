import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class EpisodeDueDateDto {
  @ApiProperty()
  @IsUUID('4')
  episodeId: string;

  @ApiProperty({ example: '2026-11-15', description: 'Day the studio must deliver the episode (BR-38).' })
  @IsDateString({ strict: true })
  dueDate: string;
}

class StudioDto {
  @ApiProperty({ example: 'Studio Ánh Trăng' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  studioName: string;

  @ApiProperty({ example: 'contact@anhtrang.studio' })
  @IsEmail()
  @MaxLength(255)
  studioEmail: string;

  @ApiPropertyOptional({ example: 'Chị Lan — 0901 234 567' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  studioContact?: string;
}

/** Step 3: the studio and the deadline of every episode. */
export class HandOffRequestDto extends StudioDto {
  @ApiProperty({ type: [EpisodeDueDateDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => EpisodeDueDateDto)
  dueDates: EpisodeDueDateDto[];
}

export class ChangeStudioRequestDto extends StudioDto {
  @ApiProperty({ example: 'The first studio missed two deadlines.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
}

export class SetDueDatesRequestDto {
  @ApiProperty({ type: [EpisodeDueDateDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => EpisodeDueDateDto)
  dueDates: EpisodeDueDateDto[];
}

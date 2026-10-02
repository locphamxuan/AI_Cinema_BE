import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

/** Step 3: the studio; each episode is due on the deadline the Reviewer set. */
export class HandOffRequestDto extends StudioDto {}

export class ChangeStudioRequestDto extends StudioDto {
  @ApiProperty({ example: 'The first studio missed two deadlines.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
}

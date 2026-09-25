import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class UpdatePlatformSettingRequestDto {
  @ApiPropertyOptional({
    example: 3600,
    nullable: true,
    description:
      'Longest an episode may be allotted by the Reviewer or planned by the Creator, in seconds. null removes the limit.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(60)
  @Max(6 * 60 * 60)
  @IsOptional()
  maxEpisodeDurationSeconds?: number | null;
}

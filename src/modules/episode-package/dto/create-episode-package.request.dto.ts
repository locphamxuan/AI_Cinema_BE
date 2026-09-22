import { IsArray, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEpisodePackageRequestDto {
  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the user/system that assembles the package.',
  })
  @IsUUID()
  @IsOptional()
  assembledById?: string;

  @ApiPropertyOptional({
    description:
      'UUID of the COMPLETED VIDEO_ASSEMBLY generation job. Optional - the package can be assembled without it.',
  })
  @IsUUID()
  @IsOptional()
  assemblyJobId?: string;

  @ApiPropertyOptional({
    example: ['f9e8d7c6-b5a4-3210-fedc-ba9876543210'],
    description:
      'Generated asset ids to include in the package. Defaults to all GENERATED/ACCEPTED assets of the plan.',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  assetIds?: string[];
}

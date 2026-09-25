import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GenerationJobType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveRouteQueryDto {
  @ApiProperty({ example: 'CUSTOM', enum: GenerationJobType, description: 'Pipeline stage of the job.' })
  @IsEnum(GenerationJobType)
  jobType: GenerationJobType;

  @ApiPropertyOptional({
    example: 'Đồng bộ khẩu hình nhân vật',
    description: 'Creator-described function of a CUSTOM job, matched against specialist models.',
  })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  customFunction?: string;
}

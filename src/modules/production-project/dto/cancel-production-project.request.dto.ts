import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelProductionProjectRequestDto {
  @ApiPropertyOptional({
    example: 'Project is no longer in scope for this release cycle.',
    description: 'Optional reason for cancelling the production project.',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}

import { IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Callback shape the training provider (or a polling job) reports back with. */
export class CompleteTrainingRequestDto {
  @ApiProperty({
    example: 'READY',
    description: 'Outcome reported by the training provider.',
    enum: ['READY', 'FAILED'],
  })
  @IsIn(['READY', 'FAILED'])
  result: 'READY' | 'FAILED';

  @ApiPropertyOptional({
    example: 'genre-style-weights/cyberpunk-v1.safetensors',
    description: 'Required when result = READY: path/URL to the trained LoRA weights.',
  })
  @ValidateIf((dto: CompleteTrainingRequestDto) => dto.result === 'READY')
  @IsString()
  storageKey?: string;

  @ApiPropertyOptional({
    example: 'Training dataset rejected: images below minimum resolution',
    description: 'Required when result = FAILED.',
  })
  @ValidateIf((dto: CompleteTrainingRequestDto) => dto.result === 'FAILED')
  @IsString()
  failureReason?: string;

  @IsOptional()
  @IsString()
  externalTrainingJobId?: string;
}

import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddTrainingSampleRequestDto {
  @ApiProperty({
    example: 'genre-styles/khoa-hoc-vien-tuong/aicinema-scifi-style/v1/014.png',
    description:
      "Storage key of the reference image, relative to the training-data root. Must sit inside the style's datasetFolder.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  storageKey: string;

  @ApiPropertyOptional({
    example: 'wide shot, rain-soaked neon alley, magenta and cyan rim light, cinematic',
    description: 'Caption describing the reference image — fed to the LoRA trainer alongside the file.',
  })
  @IsString()
  @IsOptional()
  caption?: string;
}

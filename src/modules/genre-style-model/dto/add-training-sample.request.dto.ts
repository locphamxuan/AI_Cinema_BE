import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddTrainingSampleRequestDto {
  @ApiProperty({
    example: 'genre-style-samples/cyberpunk-v1/ref-014.png',
    description: 'Object storage key/path of the uploaded reference image for this genre style.',
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

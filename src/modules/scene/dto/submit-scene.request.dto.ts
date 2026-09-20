import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitSceneRequestDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the Content Creator who submits the generated scene.',
  })
  @IsUUID()
  submittedById: string;

  @ApiPropertyOptional({
    example: 'Scene 3 - đã generate xong video',
    description: 'Optional note for the submission.',
  })
  @IsString()
  @IsOptional()
  note?: string;
}

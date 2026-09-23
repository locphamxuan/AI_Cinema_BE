import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitSceneRequestDto {
  @ApiPropertyOptional({
    example: 'Scene 3 - đã generate xong video',
    description: 'Optional note for the submission.',
  })
  @IsString()
  @IsOptional()
  note?: string;
}

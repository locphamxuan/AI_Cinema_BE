import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** What a Creator may still change on a scene once its plan is approved. */
export class UpdateSceneDirectionRequestDto {
  @ApiPropertyOptional({ example: 'Hẻm mưa lúc nửa đêm', description: 'Title of the scene.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({
    example: 'Con hẻm ngập nước dưới ánh đèn neon, máy quay lia chậm theo nhân vật.',
    description: 'What happens in the scene; context for the Prompt Composer and the scene advisor.',
  })
  @IsString()
  @IsOptional()
  description?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNotEmpty } from 'class-validator';

export class SubmitProductionPlanSceneDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  sceneId: string;

  @ApiProperty({
    example: 'Nhân vật chính bước vào căn phòng...',
  })
  @IsString()
  @IsNotEmpty()
  scriptText: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SubscribeRequestDto {
  @ApiProperty({ example: '9a5e1c22-8b3d-4f77-a0c1-6d2e3f4a5b6c', description: 'Plan to join' })
  @IsString()
  planId: string;
}

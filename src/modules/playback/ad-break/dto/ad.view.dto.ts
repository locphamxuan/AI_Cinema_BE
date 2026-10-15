import { ApiProperty } from '@nestjs/swagger';
import { AdStatus } from '@prisma/client';

export class AdViewDto {
  @ApiProperty({ example: 'a1...' })
  id: string;

  @ApiProperty({ example: 'Trà sữa Gong Cha — mua 1 tặng 1' })
  title: string;

  @ApiProperty({ example: 'https://cdn.aicinema.example/public/ads/gongcha-15s.mp4' })
  mediaUrl: string;

  @ApiProperty({ example: null, nullable: true })
  clickUrl: string | null;

  @ApiProperty({ example: 15 })
  durationSeconds: number;

  @ApiProperty({ example: 3 })
  weight: number;

  @ApiProperty({ enum: AdStatus, example: 'ACTIVE' })
  status: AdStatus;
}

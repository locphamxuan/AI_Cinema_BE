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

  @ApiProperty({ example: null, nullable: true, description: 'The ad is drawn only from this moment; null = open' })
  validFrom: Date | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'The ad is no longer drawn from this moment; null = open',
  })
  validTo: Date | null;
}

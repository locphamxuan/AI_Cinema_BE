import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AccessSource } from '@prisma/client';

/**
 * What a purchase of an episode or of a whole series returns: what was paid, how the Coins were
 * taken (main first) and the entitlement that now opens the content.
 */
export class PurchaseResultDto {
  @ApiProperty({
    example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33',
    description: 'Episode unlocked',
  })
  episodeId?: string;

  @ApiPropertyOptional({
    example: '3a71f0d4-9c22-4c6b-8f31-1a2b3c4d5e6f',
    description: 'Movie unlocked as a whole',
  })
  movieId?: string;

  @ApiProperty({ example: 25 })
  paidCoins: number;

  @ApiProperty({
    example: { mainCoins: 10, bonusCoins: 15 },
    description: 'Main Coins first, then bonus Coins',
  })
  charged: { mainCoins: number; bonusCoins: number };

  @ApiProperty({ example: 0 })
  mainBalance: number;

  @ApiProperty({ example: 0 })
  bonusBalance: number;

  @ApiProperty({
    example: { source: 'EPISODE_PURCHASE', grantedAt: '2026-10-05T03:10:00.000Z' },
  })
  access: { source: AccessSource; grantedAt: Date };

  @ApiProperty({ example: true })
  accessGranted: boolean;

  @ApiPropertyOptional({
    example: 12,
    description: 'Episodes the series purchase opens; only for a series purchase',
  })
  unlockedEpisodes?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'The request had been paid already and was not charged twice',
  })
  idempotent?: boolean;
}

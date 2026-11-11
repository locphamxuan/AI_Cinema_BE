import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccessRequired {
  @ApiProperty({
    example: 25,
    description: 'Coin price of the episode',
  })
  coinPrice: number;

  @ApiPropertyOptional({
    example: true,
    description: 'The episode is free for Guests (no sign-up required); implies free for Members too (BR-03)',
  })
  isFreeForGuest?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'The episode is free for Members without a Monthly plan and without Coins (BR-03)',
  })
  isFreeForMember?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'The episode is one of the Free Starter episodes (kept for rows that predate the flags)',
  })
  isFreeStarter?: boolean;

  @ApiPropertyOptional({
    example: 900,
    description: 'Coin price of one cycle of the cheapest running plan',
  })
  monthlyPlanCoinPrice?: number | null;

  @ApiPropertyOptional({ example: 10 })
  mainBalance?: number;

  @ApiPropertyOptional({ example: 120 })
  bonusBalance?: number;

  @ApiPropertyOptional({ example: false })
  enoughCoins?: boolean;

  @ApiPropertyOptional({ example: 15 })
  missingCoins?: number;

  @ApiPropertyOptional({ example: false })
  enoughForPlan?: boolean;
}
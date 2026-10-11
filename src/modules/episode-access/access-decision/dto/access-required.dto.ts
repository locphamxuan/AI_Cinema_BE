import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccessRequired {
  @ApiProperty({
    example: 25,
    description: 'Coin price of the episode',
  })
  coinPrice: number;

  @ApiPropertyOptional({
    example: false,
    description: 'The episode is one of the Free Starter episodes',
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

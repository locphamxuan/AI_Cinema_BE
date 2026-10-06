import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Only the fields sent are changed. */
export class UpdatePlatformSettingRequestDto {
  @ApiPropertyOptional({
    example: 2,
    description: 'First episodes of every movie Guests and Free members watch (BR-03).',
  })
  @IsInt()
  @Min(0)
  @Max(20)
  @IsOptional()
  freeStarterEpisodeCount?: number;

  @ApiPropertyOptional({ example: 1000, description: 'VND value of one Token, the unit of production fees (BR-45).' })
  @IsInt()
  @Min(1)
  @IsOptional()
  tokenRateVnd?: number;

  @ApiPropertyOptional({ example: 1000, description: 'VND value of one main Coin, the unit of revenue (BR-45).' })
  @IsInt()
  @Min(1)
  @IsOptional()
  coinRateVnd?: number;

  @ApiPropertyOptional({ example: 1, description: 'Lowest valid Coin price of an episode (BR-47).' })
  @IsInt()
  @Min(0)
  @IsOptional()
  episodeCoinPriceMin?: number;

  @ApiPropertyOptional({ example: 50, description: 'Highest valid Coin price of an episode (BR-47).' })
  @IsInt()
  @Min(0)
  @IsOptional()
  episodeCoinPriceMax?: number;

  @ApiPropertyOptional({ example: 30, description: 'Days a bonus coin lot stays usable (BR-28).' })
  @IsInt()
  @Min(1)
  @IsOptional()
  bonusCoinExpiryDays?: number;

  @ApiPropertyOptional({
    example: 90,
    description: 'Seconds without a heartbeat before a playback session times out (BR-36).',
  })
  @IsInt()
  @Min(10)
  @IsOptional()
  playbackHeartbeatTimeoutSeconds?: number;

  @ApiPropertyOptional({
    example: 24,
    description: 'Hours before the renewal date a member may still stop auto-renew; later is refused.',
  })
  @IsInt()
  @Min(0)
  @Max(720)
  @IsOptional()
  subscriptionCancelWindowHours?: number;

  @ApiPropertyOptional({
    example: 48,
    description: 'Hours auto-renew keeps retrying a cycle the wallet could not cover before the plan ends.',
  })
  @IsInt()
  @Min(0)
  @Max(720)
  @IsOptional()
  planRenewalGraceHours?: number;

  @ApiPropertyOptional({ example: 50, description: 'Bonus Coins a new account is given; 0 = none.' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  @IsOptional()
  newMemberBonusCoins?: number;

  @ApiPropertyOptional({ example: 10000, description: 'Lowest VND amount of a single Coin top-up.' })
  @IsInt()
  @Min(1000)
  @IsOptional()
  coinTopUpMinVnd?: number;

  @ApiPropertyOptional({ example: 2000000, description: 'Highest VND amount of a single Coin top-up.' })
  @IsInt()
  @Min(1000)
  @IsOptional()
  coinTopUpMaxVnd?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Refund in main Coins what a Member paid for an episode taken down for good.',
  })
  @IsBoolean()
  @IsOptional()
  refundOnRemoval?: boolean;
}

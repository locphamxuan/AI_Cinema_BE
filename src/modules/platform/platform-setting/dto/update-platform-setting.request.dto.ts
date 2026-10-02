import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

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
}

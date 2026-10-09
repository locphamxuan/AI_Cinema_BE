import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const MAX_COINS = 1_000_000_000;

/** `POST /api/admin/wallet-adjustments`: a correction is always explained. */
export class WalletAdjustmentRequestDto {
  @ApiProperty({ description: 'Account to correct' })
  @IsString()
  userId: string;

  @ApiPropertyOptional({ example: 100, description: 'Main Coins to add (negative to take away)' })
  @IsInt()
  @Min(-MAX_COINS)
  @Max(MAX_COINS)
  @IsOptional()
  mainAmount?: number;

  @ApiPropertyOptional({ example: 20, description: 'Bonus Coins to add (negative to take away)' })
  @IsInt()
  @Min(-MAX_COINS)
  @Max(MAX_COINS)
  @IsOptional()
  bonusAmount?: number;

  @ApiProperty({ example: 'Compensating a failed top-up reported by the member' })
  @IsString()
  @MaxLength(500)
  reason: string;
}

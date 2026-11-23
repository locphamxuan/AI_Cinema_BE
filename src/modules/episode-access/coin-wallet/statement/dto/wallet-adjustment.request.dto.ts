import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

const MAX_COINS = 1_000_000_000;

/** `POST /api/admin/wallet-adjustments`: a correction is always explained. */
export class WalletAdjustmentRequestDto {
  @ApiProperty({ description: 'Account to correct' })
  @IsUUID()
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
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

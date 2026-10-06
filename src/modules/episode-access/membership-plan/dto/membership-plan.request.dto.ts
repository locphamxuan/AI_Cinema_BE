import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionEndReason, SubscriptionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SetPlanPriceRequestDto {
  @ApiProperty({ example: 300, minimum: 1, description: 'Coin price of one cycle' })
  @IsInt()
  @Min(1)
  priceCoins: number;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description: 'When the new price starts; now when omitted',
  })
  @IsDateString()
  @IsOptional()
  @Type(() => Date)
  effectiveFrom?: Date;
}

export class SubscribeRequestDto {
  @ApiProperty({ example: '9a5e1c22-8b3d-4f77-a0c1-6d2e3f4a5b6c', description: 'Plan to join' })
  @IsString()
  planId: string;
}

export class CancelSubscriptionRequestDto {
  @ApiPropertyOptional({ example: 'Member asked to leave after the trial', description: 'Why the Admin ended it' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class AdminSubscriptionFilterDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  planId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsDateString()
  @IsOptional()
  to?: string;
}

export class SubscriptionView {
  @ApiProperty() id: string;
  @ApiProperty({ enum: SubscriptionStatus }) status: SubscriptionStatus;
  @ApiProperty() autoRenew: boolean;
  @ApiProperty() priceCoins: number;
  @ApiProperty() currentPeriodStart: Date;
  @ApiProperty() currentPeriodEnd: Date;
  @ApiProperty({ nullable: true }) nextRenewalAt: Date | null;
  @ApiProperty({ nullable: true, description: 'Last moment a cancellation is still accepted' })
  cancelWindowEndsAt: Date | null;
  @ApiProperty({ nullable: true, description: 'Alias of cancelWindowEndsAt' })
  cancelDeadline: Date | null;
  @ApiPropertyOptional({ enum: SubscriptionEndReason, nullable: true }) endReason: SubscriptionEndReason | null;
}

/** Step 10: a PENDING intent quotes the price without moving any Coin. */
export class SubscriptionIntentView {
  @ApiProperty() id: string;
  @ApiProperty() planId: string;
  @ApiProperty({ example: 'MONTHLY' }) planCode: string;
  @ApiProperty({ enum: SubscriptionStatus, example: SubscriptionStatus.PENDING }) status: SubscriptionStatus;
  @ApiProperty({ example: true }) autoRenew: boolean;
  @ApiProperty({ example: 900 }) priceCoins: number;
  @ApiProperty({ example: 10 }) mainBalance: number;
  @ApiProperty({ example: 120 }) bonusBalance: number;
  @ApiProperty({ example: false }) enoughCoins: boolean;
  @ApiProperty({ example: 770 }) missingCoins: number;
  @ApiProperty() currentPeriodStart: Date;
  @ApiProperty() currentPeriodEnd: Date;
  @ApiProperty({ nullable: true }) nextRenewalAt: Date | null;
  @ApiProperty({ nullable: true, description: 'Last moment a cancellation is still accepted' })
  cancelDeadline: Date | null;
  @ApiProperty({ nullable: true }) cancelWindowEndsAt: Date | null;
}

/** Step 16: the first cycle paid with Coin, main Coins before bonus Coins. */
export class SubscriptionActivationView {
  @ApiProperty() id: string;
  @ApiProperty({ enum: SubscriptionStatus, example: SubscriptionStatus.ACTIVE }) status: SubscriptionStatus;
  @ApiProperty({ example: 900 }) priceCoins: number;
  @ApiProperty({ example: { mainCoins: 10, bonusCoins: 890 } }) charged: { mainCoins: number; bonusCoins: number };
  @ApiProperty({ example: 0 }) mainBalance: number;
  @ApiProperty({ example: 0 }) bonusBalance: number;
  @ApiProperty() currentPeriodStart: Date;
  @ApiProperty() currentPeriodEnd: Date;
  @ApiProperty({ nullable: true }) nextRenewalAt: Date | null;
  @ApiProperty({ example: 1 }) cycleNumber: number;
  @ApiProperty({ example: true, description: 'The episode just picked is now covered by the plan' })
  episodeAccessGranted: boolean;
}

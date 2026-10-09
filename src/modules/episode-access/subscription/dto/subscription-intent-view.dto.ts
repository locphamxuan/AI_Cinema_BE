import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionStatus } from '@prisma/client';

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

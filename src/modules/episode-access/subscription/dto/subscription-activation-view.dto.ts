import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionStatus } from '@prisma/client';

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

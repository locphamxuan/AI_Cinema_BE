import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus, SubscriptionEndReason } from '@prisma/client';

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

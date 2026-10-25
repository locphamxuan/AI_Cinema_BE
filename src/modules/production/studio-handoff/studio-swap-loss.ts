import { EmailStatus, StudioMilestoneStatus } from '@prisma/client';
/**
 * BR-59: the fee of a replaced hand-off is spent once the studio got the brief and did not decline it. A brief
 * that never left (email failed) or a studio that said no costs nothing, so the season keeps that Token.
 */
export function lostOnReplace(handoff: {
  milestoneStatus: StudioMilestoneStatus;
  productionFeeTokens: bigint;
  emailMessage: { status: EmailStatus } | null;
}): bigint {
  if (handoff.milestoneStatus === StudioMilestoneStatus.STUDIO_DECLINED) return 0n;
  if (handoff.emailMessage?.status === EmailStatus.FAILED) return 0n;
  return handoff.productionFeeTokens;
}

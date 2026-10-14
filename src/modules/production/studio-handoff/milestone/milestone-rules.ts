import { BadRequestException, ConflictException } from '@nestjs/common';
import { StudioMilestoneStatus as Milestone } from '@prisma/client';

/**
 * Where a hand-off can go next (BR-58). A delivered episode that the Reviewer sends back reopens the
 * work (DELIVERED → IN_PROGRESS); a declined or superseded hand-off is final.
 */
const NEXT: Record<Milestone, Milestone[]> = {
  [Milestone.BRIEF_SENT]: [Milestone.STUDIO_ACCEPTED, Milestone.STUDIO_DECLINED],
  [Milestone.STUDIO_ACCEPTED]: [Milestone.IN_PROGRESS, Milestone.STUDIO_DECLINED],
  [Milestone.IN_PROGRESS]: [Milestone.DELIVERED, Milestone.STUDIO_DECLINED],
  [Milestone.DELIVERED]: [Milestone.IN_PROGRESS],
  [Milestone.STUDIO_DECLINED]: [],
  [Milestone.SUPERSEDED]: [],
};

export function assertMilestoneMove(from: Milestone, to: Milestone): void {
  if (!NEXT[from].includes(to)) {
    throw new ConflictException(`A hand-off cannot go from ${from} to ${to}`);
  }
}

/** What each target milestone needs on top of the move itself. */
export function assertMilestoneInput(to: Milestone, input: { note?: string; mediaAssetId?: string }): void {
  if (to === Milestone.STUDIO_DECLINED && !input.note?.trim()) {
    throw new BadRequestException('Say why the studio declined (note)');
  }
  if (to === Milestone.DELIVERED && !input.mediaAssetId) {
    throw new BadRequestException('A delivery needs the Submission uploaded from the studio (mediaAssetId)');
  }
  if (to !== Milestone.DELIVERED && input.mediaAssetId) {
    throw new BadRequestException('Only the DELIVERED milestone carries a Submission');
  }
}

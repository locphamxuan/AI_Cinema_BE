import { EpisodeStatus, type MediaSourceMethod, type Prisma } from '@prisma/client';
import type { AiDisclosureDto, SubmitMediaLinkRequestDto } from './dto/submit-media.request.dto';

/** A delivery is accepted while the studio still owes the episode, or replaces one under review. */
export const SUBMITTABLE: EpisodeStatus[] = [
  EpisodeStatus.AWAITING_MEDIA,
  EpisodeStatus.IN_REVIEW,
  EpisodeStatus.CHANGES_REQUESTED,
];

export const ASSET_DETAIL = {
  ingestJobs: { orderBy: { createdAt: 'asc' } },
  submittedBy: { select: { id: true, fullName: true } },
  studioHandoff: { select: { id: true, studio: { select: { id: true, name: true } } } },
} satisfies Prisma.MediaAssetInclude;

export interface NewVersion {
  id: string;
  sourceMethod: MediaSourceMethod;
  sourceUrl?: string;
  storageKey?: string;
  fileSizeBytes?: bigint;
  isSelfHosted: boolean;
  aiDisclosure: AiDisclosureDto;
  proposedLabelType: SubmitMediaLinkRequestDto['proposedLabelType'];
  submissionNote?: string;
}

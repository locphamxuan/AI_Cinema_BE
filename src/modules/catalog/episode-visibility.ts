import { EpisodeStatus, type Prisma } from '@prisma/client';

/**
 * Episodes viewers see: released ones, and the ones taken down to be fixed, which stay listed
 * with a maintenance notice (BR-56). Scheduled, removed and unfinished episodes stay hidden.
 * The catalog lists them, Main Flow 2 decides access on them and Main Flow 3 re-checks them, so
 * the rule lives in one place instead of once per service.
 */
export const VISIBLE_EPISODE: Prisma.EpisodeWhereInput = {
  OR: [{ status: EpisodeStatus.PUBLISHED }, { revisionStartedAt: { not: null } }],
};

/** Shown wherever an episode under maintenance appears (BR-56). */
export const REVISION_NOTICE = 'Tập đang được bảo trì / sửa đổi nội dung';

/** Shown in watch history for an episode taken down for good (BR-52). */
export const REMOVED_NOTICE = 'Tập đã được gỡ khỏi nền tảng';

/**
 * Whether an episode can be played right now. Watch history keeps what the member watched
 * after a take-down, so it needs the same answer the catalog and Main Flow 2 give — without
 * linking the member into a dead 404/409 (P3-4).
 */
export function playbackAvailability(episode: { status: EpisodeStatus; revisionStartedAt: Date | null }): {
  available: boolean;
  notice: string | null;
} {
  if (episode.revisionStartedAt !== null) return { available: false, notice: REVISION_NOTICE };
  if (episode.status !== EpisodeStatus.PUBLISHED) return { available: false, notice: REMOVED_NOTICE };
  return { available: true, notice: null };
}

/**
 * Whether an episode can be played right now. The catalog shows it, and the access decision
 * answers with the same value so a handoff to playback never disagrees with what the viewer saw.
 * `MEDIA_NOT_READY` is defensive: a version is approved only once it streams.
 */
export const EPISODE_AVAILABILITY = {
  AVAILABLE: 'AVAILABLE',
  UNDER_REVISION: 'UNDER_REVISION',
  MEDIA_NOT_READY: 'MEDIA_NOT_READY',
} as const;

export type EpisodeAvailability = (typeof EPISODE_AVAILABILITY)[keyof typeof EPISODE_AVAILABILITY];

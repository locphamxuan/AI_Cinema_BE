import type { Ad } from '@prisma/client';

/** No random cue in the first or last minute: intros and credits stay clean. */
export const AD_EDGE_SECONDS = 60;

/** A cue the Admin placed on the episode (episode_ad_slots); `adId` null = random draw. */
export interface AdSlot {
  positionSeconds: number;
  adId: string | null;
}

/** One cue of a session's schedule, ready for the session_ad_breaks insert. */
export interface PlannedCue {
  positionSeconds: number;
  adId: string;
}

type DrawableAd = Pick<Ad, 'id'>;

/**
 * BR-32: random cue points inside (edge, duration - edge). The window is cut into `count` equal
 * parts and one point is drawn inside each, so the cues land at random but never bunch up.
 */
export function randomPositions(durationSeconds: number, count: number, random: () => number = Math.random): number[] {
  const window = durationSeconds - AD_EDGE_SECONDS * 2;
  if (count <= 0 || window < count) return [];
  const part = window / count;
  const used = new Set<number>();
  return Array.from({ length: count }, (_, i) => {
    let position = Math.floor(AD_EDGE_SECONDS + part * i + random() * part);
    while (used.has(position)) position += 1;
    used.add(position);
    return position;
  });
}

/**
 * Eligible ads in a uniform random order (Fisher-Yates), each exactly once. Every ACTIVE ad has the
 * same chance at every cue, and drawing without replacement spreads the ads of one session evenly.
 */
export function shuffled<T>(ads: T[], random: () => number = Math.random): T[] {
  const order = [...ads];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Lays the cues of one session (BR-32, BR-51).
 *
 * - The Admin placed cues on the episode: every one inside the episode is used, so the Admin
 *   decides both where and how many times. A pinned ad plays when it is still valid; any other
 *   cue takes the next ad of a random draw. Ads repeat only once every valid ad has played,
 *   because the Admin asked for that many cues.
 * - No placed cue: `fallbackCount` random cues, one distinct ad each (P4-4), so an episode gets
 *   fewer cues when there are fewer ads than the cap.
 */
export function planCues(input: {
  slots: AdSlot[];
  eligible: DrawableAd[];
  durationSeconds: number | null;
  fallbackCount: number;
  random?: () => number;
}): PlannedCue[] {
  const { slots, eligible, durationSeconds, fallbackCount, random = Math.random } = input;
  if (!durationSeconds || !eligible.length) return [];

  if (slots.length) {
    const valid = new Set(eligible.map((ad) => ad.id));
    let deck: DrawableAd[] = [];
    const draw = (): string => {
      if (!deck.length) deck = shuffled(eligible, random);
      return deck.shift()!.id;
    };
    return slots
      .filter((slot) => slot.positionSeconds > 0 && slot.positionSeconds < durationSeconds)
      .sort((a, b) => a.positionSeconds - b.positionSeconds)
      .map((slot) => ({
        positionSeconds: slot.positionSeconds,
        adId: slot.adId && valid.has(slot.adId) ? slot.adId : draw(),
      }));
  }

  const count = Math.min(fallbackCount, eligible.length);
  const positions = randomPositions(durationSeconds, count, random);
  const picks = shuffled(eligible, random);
  return positions.map((positionSeconds, i) => ({ positionSeconds, adId: picks[i].id }));
}

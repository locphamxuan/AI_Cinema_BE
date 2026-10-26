/**
 * P4-6: bounds on admin ad input. An ad longer than a few minutes stops being a
 * mid-roll and blocks the episode; an unbounded pick weight lets one ad win every
 * draw. Generous ceilings, not creative limits.
 */
export const MAX_AD_DURATION_SECONDS = 300;
export const MAX_AD_WEIGHT = 1000;
/** BR-32: cues the Admin may place on one episode; more turns the episode into an ad reel. */
export const MAX_AD_SLOTS_PER_EPISODE = 20;

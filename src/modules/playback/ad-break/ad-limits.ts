/**
 * P4-6: bounds on admin ads. A video longer than a few minutes stops being a mid-roll and
 * blocks the episode (its length is read from the file). A generous ceiling, not a creative limit.
 */
export const MAX_AD_DURATION_SECONDS = 300;
/** BR-32: cues the Admin may place on one episode; more turns the episode into an ad reel. */
export const MAX_AD_SLOTS_PER_EPISODE = 20;

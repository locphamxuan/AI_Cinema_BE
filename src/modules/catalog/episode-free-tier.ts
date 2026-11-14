/** The columns the free rule reads; every flow that grants or sells an episode selects these. */
export interface FreeTierEpisode {
  isFreeForGuest: boolean;
  isFreeForMember: boolean;
  coinPrice: number | null;
}

export interface FreeTier {
  /** Anyone may watch it, signed in or not. */
  forGuest: boolean;
  /** A signed-in member may watch it without a plan and without Coins. */
  forMember: boolean;
}

/**
 * BR-03 / BR-19 (2026-11-11): the Admin flags each episode before publishing. Free for Guests implies free
 * for Members, and an episode priced at zero is free for everyone. One rule for the catalog, the access
 * decision (MF-2), the purchase and the playback check (MF-3), so they can never disagree.
 */
export function freeTierOf(episode: FreeTierEpisode): FreeTier {
  const zero = episode.coinPrice === 0;
  const forGuest = episode.isFreeForGuest || zero;
  return { forGuest, forMember: forGuest || episode.isFreeForMember };
}

/** Whether this caller watches the episode for free: a guest by the Guest flag, a member by the Member one. */
export function isFreeFor(episode: FreeTierEpisode, signedIn: boolean): boolean {
  const tier = freeTierOf(episode);
  return signedIn ? tier.forMember : tier.forGuest;
}

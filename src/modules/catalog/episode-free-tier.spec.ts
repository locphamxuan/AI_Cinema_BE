import { freeTierOf, isFreeFor } from './episode-free-tier';

describe('freeTierOf (BR-03)', () => {
  const ep = (isFreeForGuest: boolean, isFreeForMember: boolean, coinPrice: number | null = 10) => ({
    isFreeForGuest,
    isFreeForMember,
    coinPrice,
  });

  it('makes a guest-free episode free for members too', () => {
    expect(freeTierOf(ep(true, false))).toEqual({ forGuest: true, forMember: true });
  });

  it('keeps a members-only episode closed to guests', () => {
    expect(freeTierOf(ep(false, true))).toEqual({ forGuest: false, forMember: true });
    expect(isFreeFor(ep(false, true), false)).toBe(false);
    expect(isFreeFor(ep(false, true), true)).toBe(true);
  });

  it('frees a zero-priced episode for everyone and locks an unflagged priced one', () => {
    expect(freeTierOf(ep(false, false, 0))).toEqual({ forGuest: true, forMember: true });
    expect(freeTierOf(ep(false, false))).toEqual({ forGuest: false, forMember: false });
    expect(freeTierOf(ep(false, false, null))).toEqual({ forGuest: false, forMember: false });
  });
});

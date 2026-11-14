import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertFeeFits, splitForfeit } from './handoff-fee';

describe('hand-off fee', () => {
  it('lets a fee use the budget left plus what a replaced studio gives back', () => {
    expect(() => assertFeeFits({ remainingVnd: 50_000_000 }, 80_000_000, 30_000_000)).not.toThrow();
    expect(() => assertFeeFits({ remainingVnd: 50_000_000 }, 80_000_001, 30_000_000)).toThrow(ConflictException);
  });

  it('spreads what the old studio kept over the replaced hand-offs, each up to its own fee', () => {
    const replaced = [
      { id: 'a', offeredFeeVnd: 10_000_000n },
      { id: 'b', offeredFeeVnd: 30_000_000n },
    ];
    expect(splitForfeit(replaced, 25_000_000)).toEqual([
      { id: 'a', forfeitedVnd: 10_000_000 },
      { id: 'b', forfeitedVnd: 15_000_000 },
    ]);
    expect(splitForfeit(replaced, 0)).toEqual([
      { id: 'a', forfeitedVnd: 0 },
      { id: 'b', forfeitedVnd: 0 },
    ]);
  });

  it('refuses a forfeit above the fees being replaced', () => {
    expect(() => splitForfeit([{ id: 'a', offeredFeeVnd: 10_000_000n }], 11_000_000)).toThrow(BadRequestException);
  });
});

import { TokenEntryType } from '@prisma/client';
import { baselineTokens, summariseSeasonFee, type SeasonFeeSource } from './season-fee';

const season = (entries: SeasonFeeSource['entries'], episodeCount = 4): SeasonFeeSource => ({
  id: 's1',
  seasonNumber: 1,
  title: 'Mùa 1',
  episodeProductionCost: 5000n,
  episodeCount,
  entries,
});

describe('season fee', () => {
  it('prices a season as episode price × episodes', () => {
    expect(baselineTokens(5000n, 4)).toBe(20000);
  });

  it('splits what was paid into the baseline, the "+… Token thêm" and corrections', () => {
    const fee = summariseSeasonFee(
      season([
        { entryType: TokenEntryType.INITIAL, amountTokens: 20000n },
        { entryType: TokenEntryType.TOP_UP, amountTokens: 5000n },
        { entryType: TokenEntryType.CORRECTION, amountTokens: -1000n },
      ]),
    );
    expect(fee).toMatchObject({
      baselineTokens: 20000,
      allocatedTokens: 20000,
      supplementTokens: 5000,
      correctionTokens: -1000,
      totalTokens: 24000,
      missingTokens: 0,
      hasInitial: true,
    });
  });

  it('reports what is missing once episodes were added after the allocation', () => {
    const entries = [{ entryType: TokenEntryType.INITIAL, amountTokens: 20000n }];
    expect(summariseSeasonFee(season(entries, 6)).missingTokens).toBe(10000);
    expect(summariseSeasonFee(season([], 4))).toMatchObject({ missingTokens: 20000, hasInitial: false });
  });

  it('keeps what replaced studios cost apart from what a new brief may still promise (BR-59)', () => {
    const entries = [
      { entryType: TokenEntryType.INITIAL, amountTokens: 20000n },
      { entryType: TokenEntryType.TOP_UP, amountTokens: 8000n },
    ];
    expect(summariseSeasonFee({ ...season(entries), lostTokens: 20000n })).toMatchObject({
      totalTokens: 28000,
      lostTokens: 20000,
      availableTokens: 8000,
    });
    expect(summariseSeasonFee({ ...season(entries), lostTokens: 30000n }).availableTokens).toBe(0);
    expect(summariseSeasonFee(season(entries))).toMatchObject({ lostTokens: 0, availableTokens: 28000 });
  });
});

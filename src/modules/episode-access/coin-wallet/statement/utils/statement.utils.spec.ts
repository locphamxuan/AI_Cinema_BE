import { CoinEntryType } from '@prisma/client';
import { toStatementFilter } from './statement.utils';

describe('toStatementFilter', () => {
  it('reads one wallet with all counters when the screen sends no filter', () => {
    expect(toStatementFilter('u1', {})).toEqual({
      userId: 'u1',
      kind: 'ALL',
      entryType: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('parses the range the screen picked', () => {
    expect(
      toStatementFilter('u1', { kind: 'MAIN', entryType: CoinEntryType.TOP_UP, from: '2026-10-01', to: '2026-10-31' }),
    ).toEqual({
      userId: 'u1',
      kind: 'MAIN',
      entryType: 'TOP_UP',
      from: new Date('2026-10-01'),
      to: new Date('2026-10-31'),
    });
  });
});

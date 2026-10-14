import { TokenEntryType } from '@prisma/client';

export interface SeasonFeeSource {
  id: string;
  seasonNumber: number;
  title: string | null;
  episodeProductionCost: bigint;
  episodeCount: number;
  entries: { entryType: TokenEntryType; amountTokens: bigint }[];
}

/** What one season costs against what the Reviewer has paid out for it (BR-37, BR-46). */
export interface SeasonFee {
  seasonId: string;
  seasonNumber: number;
  title: string | null;
  episodeProductionCost: number;
  episodeCount: number;
  /** Price of one episode × episodes: the INITIAL allocation of the season. */
  baselineTokens: number;
  allocatedTokens: number;
  /** The "+… Token thêm" added after the baseline. */
  supplementTokens: number;
  correctionTokens: number;
  totalTokens: number;
  /** Token still owed when episodes or the price grew after the allocation; 0 when covered. */
  missingTokens: number;
  hasInitial: boolean;
}

const sum = (source: SeasonFeeSource, type: TokenEntryType) =>
  source.entries.filter((e) => e.entryType === type).reduce((total, e) => total + Number(e.amountTokens), 0);

export function baselineTokens(episodeProductionCost: bigint | number, episodeCount: number): number {
  return Number(episodeProductionCost) * episodeCount;
}

export function summariseSeasonFee(source: SeasonFeeSource): SeasonFee {
  const baseline = baselineTokens(source.episodeProductionCost, source.episodeCount);
  const allocatedTokens = sum(source, TokenEntryType.INITIAL);
  const supplementTokens = sum(source, TokenEntryType.TOP_UP);
  const correctionTokens = sum(source, TokenEntryType.CORRECTION);
  const totalTokens = allocatedTokens + supplementTokens + correctionTokens;
  return {
    seasonId: source.id,
    seasonNumber: source.seasonNumber,
    title: source.title,
    episodeProductionCost: Number(source.episodeProductionCost),
    episodeCount: source.episodeCount,
    baselineTokens: baseline,
    allocatedTokens,
    supplementTokens,
    correctionTokens,
    totalTokens,
    missingTokens: Math.max(0, baseline - totalTokens),
    hasInitial: source.entries.some((e) => e.entryType === TokenEntryType.INITIAL),
  };
}

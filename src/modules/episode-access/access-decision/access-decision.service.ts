import { Injectable, NotFoundException } from '@nestjs/common';
import { EpisodeStatus, PlanPeriod, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { WalletService } from '../coin-wallet/wallet.service';
import {
  AccessMethod,
  ACCESS_METHOD,
  ACCESS_SOURCE,
  ACTOR_TYPE,
  NEXT_ACTION,
  AccessSourceName,
} from 'src/modules/episode-access/access-decision/constants/access.constants';
import { AccessDecisionDto } from 'src/modules/episode-access/access-decision/dto/access-decision.dto';
import { AccessRequired } from 'src/modules/episode-access/access-decision/dto/access-required.dto';

/** A plan still gives access while its grace period runs, up to the end of the paid period. */
const RUNNING_PLAN: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

/** Methods a Guest may still take, in the order the flow offers them. */
const GUEST_METHODS: AccessMethod[] = [ACCESS_METHOD.REGISTER_OR_LOGIN];

/**
 * Step 6 and 7 of the flow: may this caller watch this episode, and if not, what is left to do.
 * The order of the checks is the order of the flow — Free Starter episode, an episode priced at
 * zero, a running plan, the episode bought, the series bought, and only then the ways left.
 *
 * A running plan grants every episode without writing a row per episode, which is what keeps
 * episode_accesses small; the bought rights are the rows this service reads here.
 */
@Injectable()
export class AccessDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
    private readonly wallets: WalletService,
  ) {}

  async decide(episodeId: string, userId?: string): Promise<AccessDecisionDto> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: EpisodeStatus.PUBLISHED },
      include: { movie: { select: { id: true, title: true, seriesCoinPrice: true } } },
    });
    if (!episode) {
      throw new NotFoundException({ message: 'Episode not found', details: { reason: 'EPISODE_NOT_FOUND' } });
    }
    const settings = await this.settings.get();
    // A published episode always carries a price (the release gate insists on one); the lowest
    // price of the platform stands in while a row predates the column.
    const coinPrice = episode.coinPrice ?? settings.episodeCoinPriceMin;
    const isFreeStarter = episode.episodeNumber <= settings.freeStarterEpisodeCount;
    const base = {
      episodeId: episode.id,
      movieId: episode.movieId,
      required: { coinPrice, isFreeStarter, seriesCoinPrice: episode.movie.seriesCoinPrice },
    };

    // The free rules need no account: anyone may watch these.
    if (isFreeStarter) return granted(base, ACCESS_SOURCE.FREE_STARTER);
    if (coinPrice === 0) return granted(base, ACCESS_SOURCE.FREE);

    if (!userId) {
      return {
        ...base,
        accessGranted: false,
        source: ACCESS_SOURCE.NONE,
        actorType: ACTOR_TYPE.GUEST,
        accessMethods: GUEST_METHODS,
        nextAction: NEXT_ACTION.REGISTER_OR_LOGIN,
      };
    }
    return this.forMember(episode.id, userId, base);
  }

  /** Everything a signed-in member needs: the plan, the bought rights, the balances, the gap. */
  private async forMember(
    episodeId: string,
    userId: string,
    base: { episodeId: string; movieId: string; required: AccessDecisionDto['required'] },
  ): Promise<AccessDecisionDto> {
    const [plan, episodeAccess, seriesAccess, planPrice] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: { userId, status: { in: RUNNING_PLAN } },
        orderBy: { currentPeriodEnd: 'desc' },
        include: { plan: { select: { code: true, isActive: true } } },
      }),
      this.prisma.episodeAccess.findFirst({ where: { userId, episodeId, revokedAt: null } }),
      this.prisma.seriesAccess.findFirst({ where: { userId, movieId: base.movieId, revokedAt: null } }),
      this.cheapestPlanPrice(),
    ]);
    // A plan whose entries are hidden still keeps the access its members already paid for.
    if (plan) {
      return {
        ...base,
        accessGranted: true,
        source: ACCESS_SOURCE.PLAN,
        actorType: ACTOR_TYPE.MEMBER,
        planCode: plan.plan.code,
        accessMethods: [],
        nextAction: NEXT_ACTION.HANDOFF_TO_PLAYBACK,
      };
    }
    if (episodeAccess) {
      return granted(base, episodeAccess.source, ACTOR_TYPE.MEMBER, { seriesOwned: Boolean(seriesAccess) });
    }
    if (seriesAccess) return granted(base, ACCESS_SOURCE.SERIES_PURCHASE, ACTOR_TYPE.MEMBER, { seriesOwned: true });

    return this.refused(userId, base, planPrice);
  }

  /** Access is refused: list what is left, cheapest way first, and what the wallet is short of. */
  private async refused(
    userId: string,
    base: { episodeId: string; movieId: string; required: AccessDecisionDto['required'] },
    planPrice: number | null,
  ): Promise<AccessDecisionDto> {
    const coinPrice = base.required.coinPrice;
    const wallet = await this.wallets.affordability(userId, coinPrice);
    const seriesPrice = base.required.seriesCoinPrice ?? null;
    const accessMethods: AccessMethod[] = [];
    if (planPrice !== null) accessMethods.push(ACCESS_METHOD.MONTHLY_PLAN);
    accessMethods.push(ACCESS_METHOD.UNLOCK_EPISODE);
    if (seriesPrice !== null) accessMethods.push(ACCESS_METHOD.UNLOCK_SERIES);
    if (!wallet.enoughCoins) accessMethods.push(ACCESS_METHOD.OBTAIN_COIN);

    return {
      ...base,
      accessGranted: false,
      source: ACCESS_SOURCE.NONE,
      actorType: ACTOR_TYPE.MEMBER,
      accessMethods,
      required: {
        ...base.required,
        seriesOwned: false,
        monthlyPlanCoinPrice: planPrice,
        mainBalance: wallet.mainBalance,
        bonusBalance: wallet.bonusBalance,
        enoughCoins: wallet.enoughCoins,
        missingCoins: wallet.missingCoins,
        enoughForPlan: planPrice !== null && wallet.mainBalance + wallet.bonusBalance >= planPrice,
      },
      nextAction: !wallet.enoughCoins
        ? NEXT_ACTION.OBTAIN_COIN
        : seriesPrice !== null && seriesPrice <= coinPrice
          ? NEXT_ACTION.UNLOCK_SERIES
          : NEXT_ACTION.UNLOCK_EPISODE,
    };
  }

  /**
   * The price of one cycle of the cheapest monthly plan on offer, i.e. what a plan would cost.
   * Only monthly plans are compared: the flow offers a monthly plan against an episode price, so a
   * weekly or yearly price would not be a like-for-like alternative.
   */
  private async cheapestPlanPrice(): Promise<number | null> {
    const price = await this.prisma.membershipPlanPrice.findFirst({
      where: { effectiveTo: null, plan: { isActive: true, isFree: false, period: PlanPeriod.MONTHLY } },
      orderBy: { priceCoins: 'asc' },
      select: { priceCoins: true },
    });
    return price?.priceCoins ?? null;
  }
}

/**
 * Access is granted. The prices stay as they are, because they are facts about the episode and the
 * library screen shows what the caller paid for; only the fields about what is still owed are left
 * out, since nothing is.
 */
function granted(
  base: { episodeId: string; movieId: string; required: AccessRequired },
  source: AccessSourceName,
  actorType: AccessDecisionDto['actorType'] = ACTOR_TYPE.MEMBER,
  extra: Partial<AccessRequired> = {},
): AccessDecisionDto {
  return {
    ...base,
    accessGranted: true,
    source,
    actorType,
    accessMethods: [],
    required: { ...base.required, ...extra },
    nextAction: NEXT_ACTION.HANDOFF_TO_PLAYBACK,
  };
}

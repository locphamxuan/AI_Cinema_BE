import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaIngestStatus, PlanPeriod } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import {
  EPISODE_AVAILABILITY,
  REVISION_NOTICE,
  VISIBLE_EPISODE,
  type EpisodeAvailability,
} from 'src/modules/catalog/episode-visibility';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { WalletService } from '../coin-wallet/wallet.service';
import { runningPlanWhere } from '../subscription/running-plan';
import {
  AccessMethod,
  ACCESS_METHOD,
  ACCESS_SOURCE,
  ACTOR_TYPE,
  NEXT_ACTION,
  AccessSourceName,
  ActorType,
} from 'src/modules/episode-access/access-decision/constants/access.constants';
import { AccessDecisionDto } from 'src/modules/episode-access/access-decision/dto/access-decision.dto';
import { AccessRequired } from 'src/modules/episode-access/access-decision/dto/access-required.dto';

/** Methods a Guest may still take, in the order the flow offers them. */
const GUEST_METHODS: AccessMethod[] = [ACCESS_METHOD.REGISTER_OR_LOGIN];

/** A listed episode whose approved version does not stream yet; rare, but it must not hand off. */
const MEDIA_NOT_READY_NOTICE = 'Tập chưa sẵn sàng để phát, vui lòng thử lại sau';

/** What every decision says about the episode itself, before the rules on who may watch it. */
interface DecisionBase {
  episodeId: string;
  movieId: string;
  availability: EpisodeAvailability;
  notice: string | null;
  required: AccessRequired;
}

/**
 * Step 6 and 7 of the flow: may this caller watch this episode, and if not, what is left to do.
 * The order of the checks is the order of the flow — whether the episode can be played at all
 * (BR-56 maintenance, an approved version that still streams), Free Starter episode, an episode
 * priced at zero, a running plan (the whole movie, BR-02), the episode bought, and only then the
 * ways left.
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
      where: { id: episodeId, ...VISIBLE_EPISODE },
      include: { approvedMediaAsset: { select: { ingestStatus: true, streamUrl: true } } },
    });
    if (!episode) {
      throw new NotFoundException({ message: 'Episode not found', details: { reason: 'EPISODE_NOT_FOUND' } });
    }
    const settings = await this.settings.get();
    // A published episode always carries a price (the release gate insists on one); the lowest
    // price of the platform stands in while a row predates the column.
    const coinPrice = episode.coinPrice ?? settings.episodeCoinPriceMin;
    const isFreeStarter = episode.episodeNumber <= settings.freeStarterEpisodeCount;
    const base: DecisionBase = {
      episodeId: episode.id,
      movieId: episode.movieId,
      availability: EPISODE_AVAILABILITY.AVAILABLE,
      notice: null,
      required: { coinPrice, isFreeStarter },
    };
    const actor = userId ? ACTOR_TYPE.MEMBER : ACTOR_TYPE.GUEST;

    // Playability comes before any rule about who may watch: an episode under maintenance (BR-56)
    // or without a streamable version cannot be handed off (Main Flow 3 re-checks and answers 409),
    // so saying it here keeps the caller out of that dead end, and nothing unplayable goes on sale.
    // The entitlement — a running plan or a bought row — is untouched and answers again once the
    // episode plays.
    if (episode.revisionStartedAt !== null) {
      return notPlayable(base, actor, EPISODE_AVAILABILITY.UNDER_REVISION, REVISION_NOTICE);
    }
    const media = episode.approvedMediaAsset;
    if (!media || media.ingestStatus !== MediaIngestStatus.READY || !media.streamUrl) {
      return notPlayable(base, actor, EPISODE_AVAILABILITY.MEDIA_NOT_READY, MEDIA_NOT_READY_NOTICE);
    }

    // The free rules need no account: anyone may watch these.
    if (isFreeStarter) return granted(base, ACCESS_SOURCE.FREE_STARTER, actor);
    if (coinPrice === 0) return granted(base, ACCESS_SOURCE.FREE, actor);

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
  private async forMember(episodeId: string, userId: string, base: DecisionBase): Promise<AccessDecisionDto> {
    const [plan, episodeAccess, planPrice] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: runningPlanWhere(userId),
        orderBy: { currentPeriodEnd: 'desc' },
        include: { plan: { select: { code: true, isActive: true } } },
      }),
      this.prisma.episodeAccess.findFirst({ where: { userId, episodeId, revokedAt: null } }),
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
    if (episodeAccess) return granted(base, episodeAccess.source, ACTOR_TYPE.MEMBER);

    return this.refused(userId, base, planPrice);
  }

  /** Access is refused: list what is left, cheapest way first, and what the wallet is short of. */
  private async refused(userId: string, base: DecisionBase, planPrice: number | null): Promise<AccessDecisionDto> {
    const coinPrice = base.required.coinPrice;
    const wallet = await this.wallets.affordability(userId, coinPrice);
    const accessMethods: AccessMethod[] = [];
    if (planPrice !== null) accessMethods.push(ACCESS_METHOD.MONTHLY_PLAN);
    accessMethods.push(ACCESS_METHOD.UNLOCK_EPISODE);
    if (!wallet.enoughCoins) accessMethods.push(ACCESS_METHOD.OBTAIN_COIN);

    return {
      ...base,
      accessGranted: false,
      source: ACCESS_SOURCE.NONE,
      actorType: ACTOR_TYPE.MEMBER,
      accessMethods,
      required: {
        ...base.required,
        monthlyPlanCoinPrice: planPrice,
        mainBalance: wallet.mainBalance,
        bonusBalance: wallet.bonusBalance,
        enoughCoins: wallet.enoughCoins,
        missingCoins: wallet.missingCoins,
        enoughForPlan: planPrice !== null && wallet.mainBalance + wallet.bonusBalance >= planPrice,
      },
      nextAction: wallet.enoughCoins ? NEXT_ACTION.UNLOCK_EPISODE : NEXT_ACTION.OBTAIN_COIN,
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
function granted(base: DecisionBase, source: AccessSourceName, actorType: ActorType): AccessDecisionDto {
  return {
    ...base,
    accessGranted: true,
    source,
    actorType,
    accessMethods: [],
    required: base.required,
    nextAction: NEXT_ACTION.HANDOFF_TO_PLAYBACK,
  };
}

/**
 * The episode is listed but cannot be played right now. Nothing is offered and nothing changes
 * hands: the caller sees the reason here instead of walking into a 409 at the playback handoff,
 * and nothing that cannot be watched stays on sale.
 */
function notPlayable(
  base: DecisionBase,
  actorType: ActorType,
  availability: EpisodeAvailability,
  notice: string,
): AccessDecisionDto {
  return {
    ...base,
    availability,
    notice,
    accessGranted: false,
    source: ACCESS_SOURCE.NONE,
    actorType,
    accessMethods: [],
    nextAction: NEXT_ACTION.NOT_PLAYABLE,
  };
}

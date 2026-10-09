import { NotFoundException } from '@nestjs/common';
import { EpisodeStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import { AccessDecisionService } from './access-decision.service';
import { ACCESS_METHOD, ACCESS_SOURCE, ACTOR_TYPE, NEXT_ACTION } from './constants/access.constants';

describe('AccessDecisionService.decide', () => {
  const prisma = {
    episode: { findFirst: jest.fn() },
    subscription: { findFirst: jest.fn() },
    episodeAccess: { findFirst: jest.fn() },
    seriesAccess: { findFirst: jest.fn() },
    membershipPlanPrice: { findFirst: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ freeStarterEpisodeCount: 2, episodeCoinPriceMin: 1 }) };
  const wallets = { affordability: jest.fn() };
  const service = new AccessDecisionService(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
    wallets as unknown as WalletService,
  );

  const episode = (overrides: Record<string, unknown> = {}) => ({
    id: 'ep-1',
    movieId: 'm1',
    episodeNumber: 5,
    coinPrice: 25,
    movie: { id: 'm1', title: 'M1', seriesCoinPrice: 180 },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ freeStarterEpisodeCount: 2, episodeCoinPriceMin: 1 });
    prisma.episode.findFirst.mockResolvedValue(episode());
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.episodeAccess.findFirst.mockResolvedValue(null);
    prisma.seriesAccess.findFirst.mockResolvedValue(null);
    prisma.membershipPlanPrice.findFirst.mockResolvedValue({ priceCoins: 900 });
    wallets.affordability.mockResolvedValue({
      mainBalance: 10,
      bonusBalance: 0,
      enoughCoins: false,
      missingCoins: 15,
    });
  });

  it('answers 404 when the episode is not published', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.decide('missing')).rejects.toThrow(NotFoundException);
    expect(prisma.episode.findFirst).toHaveBeenCalledWith({
      where: { id: 'missing', status: EpisodeStatus.PUBLISHED },
      include: expect.anything(),
    });
  });

  it('opens a Free Starter episode before anything else (step 3)', async () => {
    prisma.episode.findFirst.mockResolvedValue(episode({ episodeNumber: 1 }));

    await expect(service.decide('ep-1')).resolves.toMatchObject({
      accessGranted: true,
      source: ACCESS_SOURCE.FREE_STARTER,
      nextAction: NEXT_ACTION.HANDOFF_TO_PLAYBACK,
    });
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('opens an episode priced at zero', async () => {
    prisma.episode.findFirst.mockResolvedValue(episode({ coinPrice: 0 }));

    await expect(service.decide('ep-1')).resolves.toMatchObject({
      accessGranted: true,
      source: ACCESS_SOURCE.FREE,
    });
  });

  it('sends a Guest to register or log in (step 4)', async () => {
    await expect(service.decide('ep-1')).resolves.toMatchObject({
      accessGranted: false,
      actorType: ACTOR_TYPE.GUEST,
      accessMethods: [ACCESS_METHOD.REGISTER_OR_LOGIN],
      nextAction: NEXT_ACTION.REGISTER_OR_LOGIN,
    });
  });

  it('hands a running plan straight to playback (steps 6-7)', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ plan: { code: 'MONTHLY', isActive: true } });

    await expect(service.decide('ep-1', 'u1')).resolves.toMatchObject({
      accessGranted: true,
      source: ACCESS_SOURCE.PLAN,
      actorType: ACTOR_TYPE.MEMBER,
      planCode: 'MONTHLY',
      nextAction: NEXT_ACTION.HANDOFF_TO_PLAYBACK,
    });
  });

  it('honours a bought episode before the bought series', async () => {
    prisma.episodeAccess.findFirst.mockResolvedValue({ source: 'EPISODE_PURCHASE' });

    await expect(service.decide('ep-1', 'u1')).resolves.toMatchObject({
      accessGranted: true,
      source: ACCESS_SOURCE.EPISODE_PURCHASE,
    });
  });

  it('honours a bought series', async () => {
    prisma.seriesAccess.findFirst.mockResolvedValue({ source: 'SERIES_PURCHASE' });

    await expect(service.decide('ep-1', 'u1')).resolves.toMatchObject({
      accessGranted: true,
      source: ACCESS_SOURCE.SERIES_PURCHASE,
      nextAction: NEXT_ACTION.HANDOFF_TO_PLAYBACK,
    });
  });

  it('tells a short member to obtain Coins first (steps 11, 14)', async () => {
    const decision = await service.decide('ep-1', 'u1');

    expect(decision).toMatchObject({
      accessGranted: false,
      actorType: ACTOR_TYPE.MEMBER,
      nextAction: NEXT_ACTION.OBTAIN_COIN,
    });
    expect(decision.accessMethods).toEqual(
      expect.arrayContaining([
        ACCESS_METHOD.MONTHLY_PLAN,
        ACCESS_METHOD.UNLOCK_EPISODE,
        ACCESS_METHOD.UNLOCK_SERIES,
        ACCESS_METHOD.OBTAIN_COIN,
      ]),
    );
    expect(decision.required).toMatchObject({
      coinPrice: 25,
      seriesCoinPrice: 180,
      monthlyPlanCoinPrice: 900,
      missingCoins: 15,
      enoughForPlan: false,
    });
  });

  it('points a rich member at the cheaper unlock', async () => {
    wallets.affordability.mockResolvedValue({ mainBalance: 200, bonusBalance: 0, enoughCoins: true, missingCoins: 0 });

    // The episode (25) beats the series bundle (180).
    await expect(service.decide('ep-1', 'u1')).resolves.toMatchObject({
      nextAction: NEXT_ACTION.UNLOCK_EPISODE,
    });

    // ...unless the bundle is the cheaper way in.
    prisma.episode.findFirst.mockResolvedValue(episode({ coinPrice: 200 }));
    await expect(service.decide('ep-1', 'u1')).resolves.toMatchObject({
      nextAction: NEXT_ACTION.UNLOCK_SERIES,
    });
  });

  it('drops the plan method when no monthly plan is on sale', async () => {
    prisma.membershipPlanPrice.findFirst.mockResolvedValue(null);

    const decision = await service.decide('ep-1', 'u1');
    expect(decision.accessMethods).not.toContain(ACCESS_METHOD.MONTHLY_PLAN);
    expect(decision.required).toMatchObject({ monthlyPlanCoinPrice: null });
  });
});

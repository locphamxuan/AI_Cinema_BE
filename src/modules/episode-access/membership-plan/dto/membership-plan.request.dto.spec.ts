import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMembershipPlanRequestDto } from './create-membership-plan.request.dto';
import { SetPlanPriceRequestDto } from './membership-plan.request.dto';
import { UpdateMembershipPlanRequestDto } from './update-membership-plan.request.dto';

const valid = {
  code: 'premium_thang',
  name: 'Premium Tháng',
  period: 'MONTHLY',
  durationDays: 30,
  features: { maxRegisteredDevices: 4, maxConcurrentStreams: 2, adFree: true, maxQuality: '1080p' },
};

/** The property paths class-validator refuses, nested ones as `features.maxQuality`. */
async function refused<T extends object>(cls: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
  return errors.flatMap((e) =>
    e.children?.length ? e.children.map((c) => `${e.property}.${c.property}`) : [e.property],
  );
}

describe('membership plan requests', () => {
  it('accepts a monthly plan with its limits', async () => {
    expect(await refused(CreateMembershipPlanRequestDto, valid)).toEqual([]);
  });

  it.each(['premium thang', 'gói-vip', 'a'])('refuses the code %p (spaces, accents, too short)', async (code) => {
    expect(await refused(CreateMembershipPlanRequestDto, { ...valid, code })).toEqual(['code']);
  });

  it.each([7, 27, 32, 365])('refuses %i days for a monthly cycle', async (durationDays) => {
    expect(await refused(CreateMembershipPlanRequestDto, { ...valid, durationDays })).toEqual(['durationDays']);
    expect(await refused(UpdateMembershipPlanRequestDto, { durationDays })).toEqual(['durationDays']);
  });

  it('refuses a negative display order', async () => {
    expect(await refused(CreateMembershipPlanRequestDto, { ...valid, sortOrder: -1 })).toEqual(['sortOrder']);
  });

  it('checks each limit of the plan and refuses unknown ones', async () => {
    const features = {
      maxRegisteredDevices: 0,
      maxConcurrentStreams: 11,
      adFree: 'yes',
      maxQuality: '4k',
      downloads: true,
    };
    expect((await refused(UpdateMembershipPlanRequestDto, { features })).sort()).toEqual([
      'features.adFree',
      'features.downloads',
      'features.maxConcurrentStreams',
      'features.maxQuality',
      'features.maxRegisteredDevices',
    ]);
  });

  it('caps the Coin price of one cycle', async () => {
    expect(await refused(SetPlanPriceRequestDto, { priceCoins: 300 })).toEqual([]);
    expect(await refused(SetPlanPriceRequestDto, { priceCoins: 0 })).toEqual(['priceCoins']);
    expect(await refused(SetPlanPriceRequestDto, { priceCoins: 100_001 })).toEqual(['priceCoins']);
  });
});

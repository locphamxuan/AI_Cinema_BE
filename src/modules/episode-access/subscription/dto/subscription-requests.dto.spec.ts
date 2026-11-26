import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancelSubscriptionRequestDto } from './cancel-subscription.request.dto';
import { SubscribeRequestDto } from './subscribe.request.dto';

const refused = async <T extends object>(cls: new () => T, body: object) =>
  (await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('subscription requests', () => {
  it('needs the id of the plan to join', async () => {
    expect(await refused(SubscribeRequestDto, { planId: '9a5e1c22-8b3d-4f77-a0c1-6d2e3f4a5b6c' })).toEqual([]);
    expect(await refused(SubscribeRequestDto, { planId: 'MONTHLY' })).toEqual(['planId']);
  });

  it('trims the cancel reason and caps its length', async () => {
    expect(plainToInstance(CancelSubscriptionRequestDto, { reason: '  Hết nhu cầu  ' }).reason).toBe('Hết nhu cầu');
    expect(await refused(CancelSubscriptionRequestDto, {})).toEqual([]);
    expect(await refused(CancelSubscriptionRequestDto, { reason: 'x'.repeat(501) })).toEqual(['reason']);
  });
});

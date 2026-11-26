import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRewardRuleRequestDto } from '../../daily-reward/dto/create-reward-rule.request.dto';
import { MAX_REWARD_BONUS_COINS } from '../../daily-reward/reward-ladder';
import { CreateRewardPrizeRequestDto } from './create-reward-prize.request.dto';
import { SetRewardChancesRequestDto } from './set-reward-chances.request.dto';
import { UpdateRewardPrizeRequestDto } from './update-reward-prize.request.dto';

const refused = async <T extends object>(cls: new () => T, body: object) =>
  (await validate(plainToInstance(cls, body), { whitelist: true })).map((e) => e.property).sort();

const prize = { code: 'bonus_50', name: '50 Coin thưởng', type: 'BONUS_COIN', bonusCoins: 50, weight: 10 };
const rule = { code: 'streak_day_7', name: 'Ngày 7', streakDay: 7, bonusCoins: 50 };

describe('reward rule and prize requests', () => {
  it('accepts a normal prize and rung', async () => {
    expect(await refused(CreateRewardPrizeRequestDto, prize)).toEqual([]);
    expect(await refused(CreateRewardRuleRequestDto, rule)).toEqual([]);
  });

  it('caps the bonus Coins one prize or rung pays', async () => {
    const bonusCoins = MAX_REWARD_BONUS_COINS + 1;
    expect(await refused(CreateRewardPrizeRequestDto, { ...prize, bonusCoins })).toEqual(['bonusCoins']);
    expect(await refused(UpdateRewardPrizeRequestDto, { bonusCoins })).toEqual(['bonusCoins']);
    expect(await refused(CreateRewardRuleRequestDto, { ...rule, bonusCoins })).toEqual(['bonusCoins']);
  });

  it('takes a chance between 0.01 % and 100 % in basis points, on one prize or the whole wheel', async () => {
    expect(await refused(CreateRewardPrizeRequestDto, { ...prize, weight: 10_001 })).toEqual(['weight']);
    expect(await refused(CreateRewardPrizeRequestDto, { ...prize, weight: 0 })).toEqual(['weight']);
    const id = '0b1e7f9a-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(await refused(SetRewardChancesRequestDto, { prizes: [{ id, weight: 10_000 }] })).toEqual([]);
    expect(await refused(SetRewardChancesRequestDto, { prizes: [] })).toEqual(['prizes']);
    expect(await refused(SetRewardChancesRequestDto, { prizes: [{ id: 'x', weight: 1.5 }] })).toEqual(['prizes']);
  });

  it('refuses a code or name made only of spaces', async () => {
    expect(await refused(CreateRewardPrizeRequestDto, { ...prize, code: '     ', name: '  ' })).toEqual([
      'code',
      'name',
    ]);
    expect(await refused(UpdateRewardPrizeRequestDto, { name: '   ' })).toEqual(['name']);
    expect(await refused(CreateRewardRuleRequestDto, { ...rule, name: ' ' })).toEqual(['name']);
  });
});

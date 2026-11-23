import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WalletAdjustmentRequestDto } from './wallet-adjustment.request.dto';

const USER = '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33';
const refused = async (body: object) =>
  (await validate(plainToInstance(WalletAdjustmentRequestDto, body), { whitelist: true })).map((e) => e.property);

describe('WalletAdjustmentRequestDto', () => {
  it('accepts an explained correction of an account', async () => {
    expect(await refused({ userId: USER, mainAmount: 100, reason: 'Bù giao dịch lỗi' })).toEqual([]);
  });

  it('refuses an account that is not an id and a blank reason', async () => {
    expect((await refused({ userId: 'abc', mainAmount: 100, reason: '   ' })).sort()).toEqual(['reason', 'userId']);
  });
});

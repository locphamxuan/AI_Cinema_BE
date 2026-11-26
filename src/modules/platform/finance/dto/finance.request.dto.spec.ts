import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReviewTransactionFlagRequestDto } from './finance.request.dto';

const refused = async (body: object) =>
  (await validate(plainToInstance(ReviewTransactionFlagRequestDto, body), { whitelist: true })).map((e) => e.property);

describe('ReviewTransactionFlagRequestDto', () => {
  it('needs a reason to lock the account, but not to dismiss', async () => {
    expect(await refused({ decision: 'ACCOUNT_LOCKED' })).toEqual(['note']);
    expect(await refused({ decision: 'ACCOUNT_LOCKED', note: '   ' })).toEqual(['note']);
    expect(await refused({ decision: 'ACCOUNT_LOCKED', note: 'Nạp lớn bất thường' })).toEqual([]);
    expect(await refused({ decision: 'DISMISSED' })).toEqual([]);
    expect(await refused({ decision: 'DISMISSED', note: '' })).toEqual([]);
  });

  it('takes only the two actions the screen offers', async () => {
    expect(await refused({ decision: 'CONFIRMED' })).toEqual(['decision']);
  });
});

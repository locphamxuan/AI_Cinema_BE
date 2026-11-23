import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStudioLegalProfileRequestDto } from './studio-legal-profile.request.dto';

const VALID = {
  address: '  12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh ',
  taxCode: ' 0312345678 ',
  bankAccount: '0123 4567-89.01',
  bankName: ' ACB ',
  representativeTitle: ' Giám đốc ',
};

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateStudioLegalProfileRequestDto, body);
  const errors = await validate(dto);
  return { dto, invalid: errors.map((e) => e.property) };
}

describe('UpdateStudioLegalProfileRequestDto', () => {
  it('trims every field and keeps only the digits of the account number', async () => {
    const { dto, invalid } = await check(VALID);
    expect(invalid).toEqual([]);
    expect(dto).toMatchObject({
      address: '12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
      taxCode: '0312345678',
      bankAccount: '01234567890 1'.replace(' ', ''),
      bankName: 'ACB',
      representativeTitle: 'Giám đốc',
    });
  });

  it('accepts a branch tax code and refuses any other shape', async () => {
    expect((await check({ ...VALID, taxCode: '0312345678-001' })).invalid).toEqual([]);
    for (const taxCode of ['031234567', '0312345678-01', '03123456789', 'MST0312345678', '']) {
      expect((await check({ ...VALID, taxCode })).invalid).toEqual(['taxCode']);
    }
  });

  it('refuses an account number with letters or of the wrong length', async () => {
    for (const bankAccount of ['12345', '12345678901234567890', '0123abc456']) {
      expect((await check({ ...VALID, bankAccount })).invalid).toEqual(['bankAccount']);
    }
  });

  it('requires every field, a blank one included', async () => {
    const { invalid } = await check({ address: '   ', taxCode: '0312345678', bankAccount: '0123456789' });
    expect(invalid.sort()).toEqual(['address', 'bankName', 'representativeTitle']);
  });
});

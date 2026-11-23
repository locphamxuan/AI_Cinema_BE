import { ConflictException } from '@nestjs/common';
import { assertLegalProfileComplete, missingLegalFields } from './studio-legal-profile';

const COMPLETE = {
  contactName: 'Nguyễn Thị Lan',
  address: '12 Nguyễn Huệ, Quận 1',
  taxCode: '0312345678',
  bankAccount: '0123456789',
  bankName: 'ACB',
  representativeTitle: 'Giám đốc',
};

describe('studio legal profile', () => {
  it('lists every empty or blank field, the representative the Admin keeps included', () => {
    expect(missingLegalFields(COMPLETE)).toEqual([]);
    expect(missingLegalFields({ ...COMPLETE, taxCode: null, bankName: '  ', contactName: null })).toEqual([
      'taxCode',
      'bankName',
      'contactName',
    ]);
  });

  it('lets a complete studio sign and refuses an incomplete one with what is missing', async () => {
    const db = { studio: { findUniqueOrThrow: jest.fn().mockResolvedValue(COMPLETE) } };
    await expect(assertLegalProfileComplete(db as never, 's1')).resolves.toBeUndefined();

    db.studio.findUniqueOrThrow.mockResolvedValue({ ...COMPLETE, address: null });
    const refused = assertLegalProfileComplete(db as never, 's1');
    await expect(refused).rejects.toBeInstanceOf(ConflictException);
    await expect(refused).rejects.toMatchObject({
      response: { details: { reason: 'STUDIO_PROFILE_INCOMPLETE', studioId: 's1', missing: ['address'] } },
    });
  });
});

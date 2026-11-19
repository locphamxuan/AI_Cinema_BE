import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStaffUserRequestDto } from 'src/modules/identity/user/dto/create-staff-user.request.dto';
import { AddCostEntryRequestDto } from 'src/modules/production/production-cost/dto/add-cost-entry.request.dto';
import { ContractPartySettingsDto } from 'src/modules/platform/platform-setting/dto/contract-party-settings.dto';

describe('Trim / NormalizeEmail', () => {
  it('refuses a name made of spaces and stores the email the way accounts are kept', async () => {
    const dto = plainToInstance(CreateStaffUserRequestDto, {
      email: '  Creator09@AICinema.com ',
      fullName: '    ',
      role: 'CONTENT_CREATOR',
      password: 'Aicinema@123',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['fullName']);
    expect(dto.email).toBe('creator09@aicinema.com');
  });

  it('trims the reason of a production cost correction', () => {
    const dto = plainToInstance(AddCostEntryRequestDto, {
      entryType: 'CORRECTION',
      amountVnd: 5000,
      reason: ' Q4 ',
    });
    expect(dto.reason).toBe('Q4');
  });
});

describe('BlankAsNull', () => {
  it('trims an optional contract field and turns an emptied one into null so it is cleared', () => {
    const dto = plainToInstance(ContractPartySettingsDto, {
      contractCompanyName: '  AI Cinema JSC ',
      contractPhone: '   ',
      contractPlace: 7,
    });
    expect(dto.contractCompanyName).toBe('AI Cinema JSC');
    expect(dto.contractPhone).toBeNull();
    expect(dto.contractPlace).toBe(7);
  });
});

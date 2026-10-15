import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStaffUserRequestDto } from 'src/modules/identity/user/dto/create-staff-user.request.dto';
import { AddReviewerTokenEntryRequestDto } from 'src/modules/production/reviewer-token/dto/reviewer-token.request.dto';

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

  it('trims a Token reason', () => {
    const dto = plainToInstance(AddReviewerTokenEntryRequestDto, {
      entryType: 'GRANT',
      amountTokens: 5,
      reason: ' Q4 ',
    });
    expect(dto.reason).toBe('Q4');
  });
});

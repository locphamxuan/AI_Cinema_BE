import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GoogleLoginRequestDto } from './google-login.request.dto';
import { RegisterRequestDto } from './register.request.dto';

const signUp = { email: 'a@example.com', password: 'Aicinema@123', fullName: 'Anh', dateOfBirth: '2000-01-01' };

async function invalid(type: new () => object, value: object): Promise<string[]> {
  return (await validate(plainToInstance(type, value))).map((error) => error.property);
}

describe('terms of use on sign-up', () => {
  it('opens an email account only when the terms are accepted', async () => {
    await expect(invalid(RegisterRequestDto, { ...signUp, acceptedTerms: true })).resolves.toEqual([]);
    await expect(invalid(RegisterRequestDto, { ...signUp, acceptedTerms: false })).resolves.toEqual(['acceptedTerms']);
    await expect(invalid(RegisterRequestDto, signUp)).resolves.toEqual(['acceptedTerms']);
  });

  it('leaves the flag optional on Google, where only a first sign-in needs it', async () => {
    const idToken = 'x'.repeat(120);
    await expect(invalid(GoogleLoginRequestDto, { idToken })).resolves.toEqual([]);
    await expect(invalid(GoogleLoginRequestDto, { idToken, acceptedTerms: true })).resolves.toEqual([]);
    await expect(invalid(GoogleLoginRequestDto, { idToken, acceptedTerms: 'yes' })).resolves.toEqual(['acceptedTerms']);
  });
});

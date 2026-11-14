import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { EmailOutboxService } from 'src/modules/platform/email/email-outbox.service';
import { hashOtp } from './credentials';
import { PasswordResetService } from './password-reset.service';

const profile = {
  id: 'f0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b',
  email: 'member@gmail.com',
  fullName: 'Member',
  dateOfBirth: null,
  phoneNumber: null,
  role: UserRole.MEMBER,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const passwordHash = bcrypt.hashSync('Aicinema@123', 4);
const INVALID = new UnauthorizedException('Invalid or expired OTP');

const otpRow = (over: Partial<{ codeHash: string; attempts: number }> = {}) => ({
  id: 'otp-1',
  userId: profile.id,
  codeHash: hashOtp('123456'),
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null,
  attempts: 0,
  createdAt: new Date(),
  ...over,
});

describe('PasswordResetService', () => {
  const user = { findUnique: jest.fn(), update: jest.fn<Promise<unknown>, [{ data: { passwordHash: string } }]>() };
  const passwordResetOtp = { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() };
  const tx = { user, passwordResetOtp };
  const prisma = { user, passwordResetOtp, $transaction: jest.fn(<T>(work: (c: typeof tx) => Promise<T>) => work(tx)) };
  const emails = {
    create: jest.fn<Promise<string>, [unknown, { text: string; to: string; notifyOnFailureId?: string }]>(),
    dispatch: jest.fn(),
  };
  const service = new PasswordResetService(prisma as unknown as PrismaService, emails as unknown as EmailOutboxService);

  beforeEach(() => {
    jest.clearAllMocks();
    emails.create.mockResolvedValue('email-1');
    passwordResetOtp.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('request', () => {
    const account = { id: profile.id, email: profile.email, passwordHash, isActive: true };

    it('retires older codes, stores only the hash and mails the new code without an in-app failure notice', async () => {
      user.findUnique.mockResolvedValue(account);
      passwordResetOtp.findFirst.mockResolvedValue(null);

      await service.request('  Member@Gmail.com ');

      expect(user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'member@gmail.com' } }));
      expect(passwordResetOtp.updateMany).toHaveBeenCalledWith({
        where: { userId: profile.id, consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      const mail = emails.create.mock.calls[0][1];
      const code = /(\d{6})/.exec(mail.text)?.[1] ?? '';
      expect(passwordResetOtp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: profile.id, codeHash: hashOtp(code) }),
      });
      expect(mail).toMatchObject({ to: profile.email, template: 'PASSWORD_RESET_OTP' });
      expect(mail.notifyOnFailureId).toBeUndefined();
      expect(emails.dispatch).toHaveBeenCalledWith('email-1');
    });

    it.each([
      ['an unknown email', null],
      ['a Google-only account', { ...account, passwordHash: null }],
      ['a deactivated account', { ...account, isActive: false }],
    ])('sends nothing for %s, answering the same way', async (_case, found) => {
      user.findUnique.mockResolvedValue(found);

      await expect(service.request(profile.email)).resolves.toBeUndefined();
      expect(passwordResetOtp.create).not.toHaveBeenCalled();
      expect(emails.dispatch).not.toHaveBeenCalled();
    });

    it('mails at most one code a minute per account', async () => {
      user.findUnique.mockResolvedValue(account);
      passwordResetOtp.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 20_000) });

      await service.request(profile.email);

      expect(passwordResetOtp.create).not.toHaveBeenCalled();
      expect(emails.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    const dto = { email: profile.email, otp: '123456', newPassword: 'Newpass123' };

    beforeEach(() => user.findUnique.mockResolvedValue({ ...profile, passwordHash }));

    it('spends a try, consumes the code and saves the new hash, returning the profile without the hash', async () => {
      passwordResetOtp.findFirst.mockResolvedValue(otpRow());

      const result = await service.reset(dto);

      expect(passwordResetOtp.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'otp-1', consumedAt: null, expiresAt: { gt: expect.any(Date) }, attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
      expect(passwordResetOtp.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'otp-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      const saved = user.update.mock.calls[0][0];
      await expect(bcrypt.compare('Newpass123', saved.data.passwordHash)).resolves.toBe(true);
      expect(result).toEqual(profile);
    });

    it.each([
      ['an unknown email', null],
      ['a Google-only account', { ...profile, passwordHash: null }],
      ['a deactivated account', { ...profile, passwordHash, isActive: false }],
    ])('gives %s the same answer as a wrong code', async (_case, found) => {
      user.findUnique.mockResolvedValue(found);

      await expect(service.reset(dto)).rejects.toThrow(INVALID);
      expect(user.update).not.toHaveBeenCalled();
    });

    it('refuses when no live code exists', async () => {
      passwordResetOtp.findFirst.mockResolvedValue(null);
      await expect(service.reset(dto)).rejects.toThrow(INVALID);
    });

    it('consumes an expired or used-up code without comparing it', async () => {
      passwordResetOtp.findFirst.mockResolvedValue(otpRow({ attempts: 5 }));
      passwordResetOtp.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.reset(dto)).rejects.toThrow(INVALID);
      expect(passwordResetOtp.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'otp-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      expect(user.update).not.toHaveBeenCalled();
    });

    it('counts a wrong code and keeps the code alive until the fifth miss', async () => {
      passwordResetOtp.findFirst.mockResolvedValue(otpRow({ codeHash: hashOtp('999999'), attempts: 1 }));

      await expect(service.reset(dto)).rejects.toThrow(INVALID);
      expect(passwordResetOtp.updateMany).toHaveBeenCalledTimes(1);
    });

    it('kills the code on the fifth wrong try', async () => {
      passwordResetOtp.findFirst.mockResolvedValue(otpRow({ codeHash: hashOtp('999999'), attempts: 4 }));

      await expect(service.reset(dto)).rejects.toThrow(INVALID);
      expect(passwordResetOtp.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'otp-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('lets only one of two racing resets with the same code change the password', async () => {
      passwordResetOtp.findFirst.mockResolvedValue(otpRow());
      passwordResetOtp.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      await expect(service.reset(dto)).rejects.toThrow(INVALID);
      expect(user.update).not.toHaveBeenCalled();
    });

    it('asks for a password different from the current one', async () => {
      passwordResetOtp.findFirst.mockResolvedValue(otpRow());

      await expect(service.reset({ ...dto, newPassword: 'Aicinema@123' })).rejects.toThrow(BadRequestException);
      expect(user.update).not.toHaveBeenCalled();
    });
  });
});

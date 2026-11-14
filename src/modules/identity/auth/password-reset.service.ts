import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { USER_PROFILE_SELECT, type UserProfile } from 'src/modules/identity/user/user-profile';
import { EMAIL_TEMPLATE, EmailOutboxService } from 'src/modules/platform/email/email-outbox.service';
import { generateOtp, hashOtp, hashPassword, normalizeEmail, otpEquals, verifyPassword } from './credentials';
import type { ResetPasswordRequestDto } from './dto/reset-password.request.dto';

export const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
/** A new code is mailed at most once a minute per account, so nobody can flood an inbox. */
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** One answer for every failed reset, so the endpoint never tells whether an email has an account. */
const INVALID_OTP = 'Invalid or expired OTP';

/**
 * Forgot password, for Members only (the Mobile app): a 6-digit code is e-mailed to an active Member account
 * that signs in with a password, and that code (latest one only, 10 minutes, 5 tries) sets a new password
 * and signs every old session out. Staff and Studio accounts get their password reset by the Admin.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailOutboxService,
  ) {}

  /** Always succeeds from the caller's side: an unknown, Google-only, locked or non-Member account gets no email. */
  async request(emailInput: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(emailInput) },
      select: { id: true, email: true, passwordHash: true, isActive: true, role: true },
    });
    if (!user?.passwordHash || !user.isActive || user.role !== UserRole.MEMBER) return;
    const latest = await this.prisma.passwordResetOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) return;

    const otp = generateOtp(OTP_LENGTH);
    const emailId = await this.prisma.$transaction(async (tx) => {
      // Only the newest code is live.
      await tx.passwordResetOtp.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.passwordResetOtp.create({
        data: {
          userId: user.id,
          codeHash: hashOtp(otp),
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
        },
      });
      return this.emails.create(tx, {
        to: user.email,
        template: EMAIL_TEMPLATE.PASSWORD_RESET_OTP,
        subject: 'Mã OTP đặt lại mật khẩu AI Cinema',
        text:
          `Mã OTP đặt lại mật khẩu của bạn là ${otp}. Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút. ` +
          'Không chia sẻ mã này với bất kỳ ai. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
        attachments: [],
      });
    });
    await this.emails.dispatch(emailId);
  }

  /** Checks the code, saves the new password and returns the account so the caller can open a session. */
  async reset(dto: ResetPasswordRequestDto): Promise<UserProfile> {
    const found = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
      select: { ...USER_PROFILE_SELECT, passwordHash: true },
    });
    if (!found?.passwordHash || !found.isActive || found.role !== UserRole.MEMBER) {
      throw new UnauthorizedException(INVALID_OTP);
    }
    const otpRow = await this.prisma.passwordResetOtp.findFirst({
      where: { userId: found.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otpRow) throw new UnauthorizedException(INVALID_OTP);
    if (!(await this.spendTry(otpRow.id))) {
      await this.consume(otpRow.id);
      throw new UnauthorizedException(INVALID_OTP);
    }
    if (!otpEquals(dto.otp, otpRow.codeHash)) {
      if (otpRow.attempts + 1 >= OTP_MAX_ATTEMPTS) await this.consume(otpRow.id);
      throw new UnauthorizedException(INVALID_OTP);
    }
    if (await verifyPassword(dto.newPassword, found.passwordHash)) {
      throw new BadRequestException('Choose a password different from the current one');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Conditional consume: of two requests racing with the same code, only one changes the password.
      const { count } = await tx.passwordResetOtp.updateMany({
        where: { id: otpRow.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (count !== 1) throw new UnauthorizedException(INVALID_OTP);
      await tx.user.update({ where: { id: found.id }, data: { passwordHash } });
    });
    const { passwordHash: _hash, ...user } = found;
    return user;
  }

  private async consume(otpId: string): Promise<void> {
    await this.prisma.passwordResetOtp.updateMany({
      where: { id: otpId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  /**
   * Takes one of the code's tries before it is compared, in a single conditional update: parallel
   * guesses cannot all read the same count and slip past the limit. False once expired or used up.
   */
  private async spendTry(otpId: string): Promise<boolean> {
    const { count } = await this.prisma.passwordResetOtp.updateMany({
      where: { id: otpId, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    return count === 1;
  }
}

import { HttpException, Inject, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';

/** Why a Google sign-in is refused, for the client to explain. */
export const GOOGLE_REASON = {
  ACCOUNT_MISMATCH: 'GOOGLE_ACCOUNT_MISMATCH',
  STAFF_ACCOUNT: 'GOOGLE_STAFF_ACCOUNT',
} as const;

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
}

/** Checks a Google ID token against the web, Android and iOS client IDs of the app. */
@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.config.google.clientIds.length) {
      throw new UnprocessableEntityException({
        message: 'Google sign-in is not configured',
        details: { reason: 'PROVIDER_NOT_CONFIGURED', provider: 'google' },
      });
    }
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.config.google.clientIds });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) throw new UnauthorizedException('Invalid Google ID token');
      if (!payload.email_verified) throw new UnauthorizedException('Google account email is not verified');
      return { sub: payload.sub, email: payload.email, name: payload.name };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new UnauthorizedException('Invalid Google ID token');
    }
  }
}

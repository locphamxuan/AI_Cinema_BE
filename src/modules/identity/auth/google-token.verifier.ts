import { HttpException, Inject, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

@Injectable()
export class GoogleTokenVerifier {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return this.config.google.clientIds.length > 0;
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new UnprocessableEntityException({
        message: 'Google sign-in is not configured',
        details: { reason: 'PROVIDER_NOT_CONFIGURED', provider: 'google' },
      });
    }
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    this.assertConfigured();
    const client = new OAuth2Client();
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: this.config.google.clientIds,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new UnauthorizedException('Invalid Google ID token');
      }
      if (!payload.email_verified) {
        throw new UnauthorizedException('Google account email is not verified');
      }
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new UnauthorizedException('Invalid Google ID token');
    }
  }
}

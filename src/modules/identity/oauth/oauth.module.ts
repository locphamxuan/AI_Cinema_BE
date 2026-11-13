import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OAuthAuthorizeService } from './oauth-authorize.service';
import { OAuthClientService } from './oauth-client.service';
import { OAuthScopeGuard } from './oauth-scope.guard';
import { OAuthTokenService } from './oauth-token.service';
import { OAuthController } from './oauth.controller';

/**
 * Studio Web login (2026-11-12): AI Cinema as the OAuth 2.0 authorization server. JwtService comes from
 * the global AuthModule; OAuthScopeGuard is registered here as an app guard so it runs after the JWT and
 * permission guards that AuthModule registered first.
 */
@Module({
  controllers: [OAuthController],
  providers: [
    OAuthClientService,
    OAuthAuthorizeService,
    OAuthTokenService,
    { provide: APP_GUARD, useClass: OAuthScopeGuard },
  ],
})
export class OAuthModule {}

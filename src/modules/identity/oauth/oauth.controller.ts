import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { appConfig } from 'src/config/config.module';
import { AuthorizeDecisionDto, AuthorizeQueryDto, RevokeRequestDto, TokenRequestDto } from './dto/oauth.request.dto';
import { OAuthAuthorizeService } from './oauth-authorize.service';
import { credentialsFromBasic } from './oauth-client.service';
import { OAuthExceptionFilter } from './oauth-error';
import { OAuthTokenService } from './oauth-token.service';

const tokenRateLimit = {
  default: { limit: () => appConfig().rateLimit.authLimit, ttl: () => appConfig().rateLimit.ttlMs },
};

/**
 * AI Cinema as an OAuth 2.0 authorization server for Studio Web (Authorization Code + PKCE).
 * `authorize` is called by AI_Cinema_FE with the studio's platform session; `token` and `revoke` are
 * called server-to-server by Studio Web. Errors leave in the RFC 6749 shape (OAuthExceptionFilter).
 */
@ApiTags('oauth')
@Controller('oauth')
@UseFilters(OAuthExceptionFilter)
export class OAuthController {
  constructor(
    private readonly authorizeService: OAuthAuthorizeService,
    private readonly tokens: OAuthTokenService,
  ) {}

  @Get('authorize')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Consent screen data for AI_Cinema_FE: client, scopes, account (RFC 6749 §4.1.1)' })
  describe(@CurrentUser() user: AuthenticatedUser, @Query() query: AuthorizeQueryDto) {
    return this.authorizeService.describe(user, query);
  }

  @Post('authorize')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The studio approves or denies; answers the redirect back to Studio Web' })
  decide(@CurrentUser() user: AuthenticatedUser, @Body() dto: AuthorizeDecisionDto) {
    return this.authorizeService.decide(user, dto);
  }

  @Public()
  @Throttle(tokenRateLimit)
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiOperation({ summary: 'Exchange a code (+ PKCE verifier) or a refresh token for tokens (RFC 6749 §4.1.3, §6)' })
  token(@Body() dto: TokenRequestDto, @Headers('authorization') authorization?: string) {
    const basic = credentialsFromBasic(authorization);
    return this.tokens.token(dto, {
      clientId: basic.clientId ?? dto.client_id,
      clientSecret: basic.clientSecret ?? dto.client_secret,
    });
  }

  @Public()
  @Throttle(tokenRateLimit)
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiOperation({ summary: 'Revoke a refresh token on sign-out (RFC 7009)' })
  async revoke(@Body() dto: RevokeRequestDto, @Headers('authorization') authorization?: string) {
    const basic = credentialsFromBasic(authorization);
    await this.tokens.revoke(dto.token, {
      clientId: basic.clientId ?? dto.client_id,
      clientSecret: basic.clientSecret ?? dto.client_secret,
    });
    return {};
  }
}

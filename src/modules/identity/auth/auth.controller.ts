import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { appConfig } from 'src/config/config.module';
import { AuthService } from './auth.service';
import { AuthProfileDto, AuthSessionDto } from './dto/auth-session.dto';
import { LoginRequestDto } from './dto/login.request.dto';
import { RefreshTokenRequestDto } from './dto/refresh-token.request.dto';
import { RegisterRequestDto } from './dto/register.request.dto';

// Guessing passwords or refresh tokens is limited far below the API-wide rate.
const authRateLimit = {
  default: { limit: () => appConfig().rateLimit.authLimit, ttl: () => appConfig().rateLimit.ttlMs },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(authRateLimit)
  @Post('register')
  @ApiOperation({ summary: 'Create a member account (18+, BR-54) and sign it in' })
  @ApiOkResponse({ type: AuthSessionDto })
  register(@Body() dto: RegisterRequestDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle(authRateLimit)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionDto })
  login(@Body() dto: LoginRequestDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Throttle(authRateLimit)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Swap a refresh token for a new token pair (the old one stops working)' })
  @ApiOkResponse({ type: AuthSessionDto })
  refresh(@Body() dto: RefreshTokenRequestDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  logout(@Body() dto: RefreshTokenRequestDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AuthProfileDto })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }
}

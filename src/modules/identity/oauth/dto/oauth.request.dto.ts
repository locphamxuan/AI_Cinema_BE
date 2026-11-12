import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The query of RFC 6749 §4.1.1 (+ RFC 7636 §4.3), as AI_Cinema_FE forwards it from the browser to read
 * the consent screen. Field names stay snake_case: they are the OAuth wire names Studio Web sends.
 */
export class AuthorizeQueryDto {
  @ApiProperty({ example: 'code' })
  @IsString()
  @MaxLength(20)
  response_type: string;

  @ApiProperty({ example: 'studio-web' })
  @IsString()
  @MaxLength(255)
  client_id: string;

  @ApiProperty({ example: 'http://localhost:3100/api/auth/callback' })
  @IsString()
  @MaxLength(500)
  redirect_uri: string;

  @ApiProperty({ example: 'studio:portal' })
  @IsString()
  @MaxLength(500)
  scope: string;

  @ApiProperty({ description: 'Opaque value Studio Web checks on the callback (CSRF)' })
  @IsString()
  @MaxLength(500)
  state: string;

  @ApiProperty({ description: 'BASE64URL(SHA256(code_verifier)), 43 characters' })
  @IsString()
  @MaxLength(255)
  code_challenge: string;

  @ApiProperty({ example: 'S256', enum: ['S256'] })
  @IsString()
  @MaxLength(10)
  code_challenge_method: string;
}

/** The studio's answer on the consent screen; the FE then sends the browser to `redirectTo`. */
export class AuthorizeDecisionDto extends AuthorizeQueryDto {
  @ApiProperty({ description: 'true = Cho phép, false = Từ chối' })
  @IsBoolean()
  approve: boolean;
}

/** RFC 6749 §4.1.3 and §6, sent as application/x-www-form-urlencoded by Studio Web's server. */
export class TokenRequestDto {
  @ApiProperty({ enum: ['authorization_code', 'refresh_token'] })
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type: 'authorization_code' | 'refresh_token';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  code?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  redirect_uri?: string;

  @ApiPropertyOptional({ description: 'The PKCE verifier the challenge was derived from' })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  code_verifier?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  refresh_token?: string;

  @ApiPropertyOptional({ description: 'client_secret_post; client_secret_basic goes in Authorization instead' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  client_id?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  client_secret?: string;
}

/** RFC 7009: revoke a refresh token on sign-out from Studio Web. */
export class RevokeRequestDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  token: string;

  @ApiPropertyOptional({ enum: ['refresh_token', 'access_token'] })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  token_type_hint?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  client_id?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  client_secret?: string;
}

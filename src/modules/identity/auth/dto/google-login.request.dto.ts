import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleLoginRequestDto {
  @ApiProperty({ description: 'Google ID token (JWT) obtained by the client.' })
  @IsString()
  @MinLength(100)
  @MaxLength(4096)
  idToken: string;

  @ApiPropertyOptional({
    example: '2003-05-14',
    description: 'Asked for (GOOGLE_SIGNUP_NEEDS_BIRTHDAY) only when the token opens a new member account (BR-54).',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Asked for (GOOGLE_LINK_NEEDS_PASSWORD) when the email already has a password account to link.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(72)
  password?: string;
}

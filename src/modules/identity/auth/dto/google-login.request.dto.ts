import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleLoginRequestDto {
  @ApiProperty({ description: 'Google ID token (JWT) obtained by the client.' })
  @IsString()
  @MinLength(100)
  @MaxLength(4096)
  idToken: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'The new member ticked "accept the terms of use". Only a first sign-in that opens the account needs it; without it that call answers GOOGLE_TERMS_REQUIRED and opens nothing.',
  })
  @IsOptional()
  @IsBoolean()
  acceptedTerms?: boolean;
}

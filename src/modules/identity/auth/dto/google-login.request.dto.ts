import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleLoginRequestDto {
  @ApiProperty({ description: 'Google ID token (JWT) obtained by the client.' })
  @IsString()
  @MinLength(100)
  @MaxLength(4096)
  idToken: string;
}

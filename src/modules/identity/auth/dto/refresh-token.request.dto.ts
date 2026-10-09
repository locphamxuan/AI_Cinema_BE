import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RefreshTokenRequestDto {
  @ApiProperty({ example: 'q3Yp0Z…', description: 'Refresh token issued by login, register or the previous refresh.' })
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

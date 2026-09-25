import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from 'src/modules/user/dto/user.dto';

export class AuthSessionDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'Short-lived access token.' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'Long-lived refresh token.' })
  refreshToken: string;

  @ApiProperty({ type: UserDto, description: 'Profile of the authenticated user.' })
  user: UserDto & { permissions: string[] };
}

import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from 'src/modules/user/dto/user.dto';

export class AuthProfileDto extends UserDto {
  @ApiProperty({
    example: ['project:manage'],
    description: 'Permissions of the account role (drives the portal menus).',
  })
  permissions: string[];
}

export class AuthSessionDto {
  @ApiProperty({ description: 'Access JWT, sent as `Authorization: Bearer <token>`.' })
  accessToken: string;

  @ApiProperty({ example: 900, description: 'Seconds until the access token expires.' })
  accessTokenExpiresIn: number;

  @ApiProperty({ description: 'Single-use refresh token; every refresh returns a new one.' })
  refreshToken: string;

  @ApiProperty({ type: AuthProfileDto })
  user: AuthProfileDto;
}

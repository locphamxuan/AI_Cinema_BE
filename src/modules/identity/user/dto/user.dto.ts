import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { UserProfile } from '../user-profile';

export class UserDto implements UserProfile {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  fullName: string;

  @ApiProperty({ example: '2003-05-14T00:00:00.000Z', nullable: true, description: 'Members only (BR-54).' })
  dateOfBirth: Date | null;

  @ApiProperty({ enum: UserRole, example: UserRole.MEMBER })
  role: UserRole;

  @ApiProperty({ example: true, description: 'false = locked: the account can no longer sign in.' })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class UserDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the user.',
  })
  id: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'Email of the user.',
  })
  email: string;

  @ApiProperty({
    example: 'Nguyen Van A',
    description: 'Full name of the user.',
  })
  fullName: string;

  @ApiProperty({
    example: true,
    description: 'Whether the user account is active.',
  })
  isActive: boolean;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Creation timestamp of the user.',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Last update timestamp of the user.',
  })
  updatedAt: Date;
}

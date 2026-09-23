import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterRequestDto {
  @ApiProperty({ example: 'creator01@aicinema.com', description: 'Email of the new account.' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Aicinema@123', description: 'Plain-text password, at least 6 characters.' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'Nguyen Minh Anh', description: 'Display name of the account owner.' })
  @IsString()
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ enum: UserRole, example: UserRole.CONTENT_CREATOR, description: 'Role of the new account.' })
  @IsEnum(UserRole)
  role: UserRole;
}

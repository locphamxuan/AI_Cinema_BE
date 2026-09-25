import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Public sign-up of a viewer account. Staff roles (Creator, Reviewer, Admin) are
 * never self-assigned: they are provisioned by the seed or an admin.
 */
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
}

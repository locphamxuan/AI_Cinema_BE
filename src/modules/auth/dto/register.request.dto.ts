import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_HINT, PASSWORD_RULE } from './password-rule';

/**
 * Public sign-up of a viewer account. Staff roles (Creator, Reviewer, Staff, Admin) are
 * never self-assigned: the Admin creates them.
 */
export class RegisterRequestDto {
  @ApiProperty({ example: 'member01@aicinema.com', description: 'Email of the new account.' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Aicinema@123', description: PASSWORD_HINT })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  password: string;

  @ApiProperty({ example: 'Nguyen Minh Anh', description: 'Display name of the account owner.' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ example: '2003-05-14', description: 'Date of birth; members must be 18 or older (BR-54).' })
  @IsDateString({ strict: true })
  dateOfBirth: string;
}

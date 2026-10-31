import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_HINT, PASSWORD_RULE } from './password-rule';

import { NormalizeEmail, Trim } from 'src/common/validation/trim';

/**
 * Public sign-up of a viewer account. Staff roles (Creator, Reviewer, Staff, Admin) are
 * never self-assigned: the Admin creates them.
 */
export class RegisterRequestDto {
  @ApiProperty({ example: 'thanhvien@gmail.com', description: 'Email of the new account.' })
  @NormalizeEmail()
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
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName: string;

  /** BR-54: sign-up no longer asks for a birthday; still accepted (and ignored) so older app builds keep working. */
  @ApiHideProperty()
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;
}

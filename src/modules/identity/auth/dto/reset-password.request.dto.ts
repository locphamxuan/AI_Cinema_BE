import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_HINT, PASSWORD_RULE } from './password-rule';
import { NormalizeEmail } from 'src/common/validation/trim';

export class ResetPasswordRequestDto {
  @ApiProperty({ example: 'member@gmail.com' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  otp: string;

  @ApiProperty({ description: PASSWORD_HINT })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  newPassword: string;
}

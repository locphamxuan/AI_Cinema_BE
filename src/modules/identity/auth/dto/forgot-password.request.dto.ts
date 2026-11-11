import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';
import { NormalizeEmail } from 'src/common/validation/trim';

export class ForgotPasswordRequestDto {
  @ApiProperty({ example: 'member@gmail.com' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(255)
  email: string;
}

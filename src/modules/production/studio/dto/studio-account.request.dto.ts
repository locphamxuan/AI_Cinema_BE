import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_HINT, PASSWORD_RULE } from 'src/modules/identity/auth/dto/password-rule';
import { NormalizeEmail, Trim } from 'src/common/validation/trim';

/** Admin opens a login for a partner studio (MF-1, 07/11/2026). */
export class CreateStudioAccountRequestDto {
  @ApiProperty({ example: 'sanxuat@lumenstudio.vn' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Nguyễn Thị Lan (Lumen Studio)' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ example: 'Studio@123', description: `Initial password. ${PASSWORD_HINT}` })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  password: string;
}

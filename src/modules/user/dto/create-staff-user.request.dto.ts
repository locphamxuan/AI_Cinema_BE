import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_HINT, PASSWORD_RULE } from 'src/modules/auth/dto/password-rule';

const STAFF_ROLES = [UserRole.CONTENT_CREATOR, UserRole.CONTENT_REVIEWER, UserRole.STAFF, UserRole.ADMIN];

export class CreateStaffUserRequestDto {
  @ApiProperty({ example: 'creator09@aicinema.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Lê Minh Châu' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ enum: STAFF_ROLES, example: UserRole.CONTENT_CREATOR })
  @IsIn(STAFF_ROLES)
  role: UserRole;

  @ApiProperty({ example: 'Aicinema@123', description: `Initial password. ${PASSWORD_HINT}` })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  password: string;
}

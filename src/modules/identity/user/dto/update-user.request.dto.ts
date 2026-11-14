import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_HINT, PASSWORD_RULE } from 'src/modules/identity/auth/dto/password-rule';

import { NormalizeEmail, Trim } from 'src/common/validation/trim';

/** Roles an account can be moved to; STUDIO needs its studio (POST /studios/:id/accounts). */
const ASSIGNABLE_ROLES = Object.values(UserRole).filter((role) => role !== UserRole.STUDIO);

export class UpdateUserRequestDto {
  @ApiPropertyOptional({ example: 'Lê Minh Châu' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @IsOptional()
  fullName?: string;

  @ApiPropertyOptional({ example: 'creator02@gmail.com', description: 'Must stay unique.' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(255)
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: `New password set by the Admin; signs the account out everywhere. ${PASSWORD_HINT}`,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({
    enum: ASSIGNABLE_ROLES,
    example: UserRole.CONTENT_CREATOR,
    description: 'New role of the account; a STUDIO login is opened from its studio instead.',
  })
  @IsIn(ASSIGNABLE_ROLES)
  @IsOptional()
  role?: UserRole;

  @ApiPropertyOptional({
    example: false,
    description: 'false locks the account: it can no longer sign in or call the API.',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

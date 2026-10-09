import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_HINT, PASSWORD_RULE } from 'src/modules/identity/auth/dto/password-rule';

export class UpdateUserRequestDto {
  @ApiPropertyOptional({ example: 'Lê Minh Châu' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @IsOptional()
  fullName?: string;

  @ApiPropertyOptional({ example: 'creator09@aicinema.com', description: 'Must stay unique.' })
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

  @ApiPropertyOptional({ enum: UserRole, example: UserRole.CONTENT_CREATOR, description: 'New role of the account.' })
  @IsEnum(UserRole)
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

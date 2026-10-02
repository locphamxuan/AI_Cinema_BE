import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateUserRequestDto {
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

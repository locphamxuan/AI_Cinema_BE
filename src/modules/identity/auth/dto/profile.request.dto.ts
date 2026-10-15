import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PASSWORD_HINT, PASSWORD_RULE } from './password-rule';

/** A phone number as people type it: digits, an optional leading +, spaces or dots; 8 to 15 digits. */
export const PHONE_RULE = /^\+?[0-9][0-9 .]{6,18}[0-9]$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** The account owner edits their own profile; role, email and status stay with the Admin. */
export class UpdateMyProfileRequestDto {
  @ApiPropertyOptional({ example: 'Nguyen Minh Anh' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @IsOptional()
  fullName?: string;

  @ApiPropertyOptional({ example: '0912345678', nullable: true, description: 'Empty or null clears it.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(PHONE_RULE, { message: 'Phone number must have 8 to 15 digits' })
  @IsOptional()
  phoneNumber?: string | null;

  @ApiPropertyOptional({ example: '1998-05-14' })
  @IsDateString({ strict: true })
  @IsOptional()
  dateOfBirth?: string;
}

export class ChangeMyPasswordRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  currentPassword: string;

  @ApiProperty({ description: PASSWORD_HINT })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_HINT })
  newPassword: string;
}

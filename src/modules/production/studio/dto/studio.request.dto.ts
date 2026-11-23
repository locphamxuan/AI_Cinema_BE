import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * What the Admin records about a partner studio. Its legal profile (address, tax code, bank account, title of
 * the representative) is filled in by the studio itself on Studio Web since 22/11/2026, never here.
 */
export class CreateStudioRequestDto {
  @ApiProperty({ example: 'Studio Ánh Trăng' })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'contact@anhtrang.studio', description: 'Where briefs are sent; unique in the catalog.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional({ example: 'Chị Lan', description: 'Legal representative who signs the contract (Bên B).' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(255)
  @IsOptional()
  contactName?: string;

  @ApiPropertyOptional({ example: '0901 234 567' })
  @Transform(trimmed)
  @Matches(/^[0-9+().\s-]{6,30}$/, { message: 'phone must be a phone number' })
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'Chuyên phim kinh dị, giao đúng hạn.' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  note?: string;
}

export class UpdateStudioRequestDto extends PartialType(CreateStudioRequestDto) {
  @ApiPropertyOptional({ description: 'false hides the studio from new projects and hand-offs (BR-59).' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class StudioListQueryDto {
  @ApiPropertyOptional({ description: 'true lists only the studios that can take a new project.' })
  // The raw string: implicit conversion would read 'false' as true.
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
    obj[key] === 'true' ? true : obj[key] === 'false' ? false : obj[key],
  )
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

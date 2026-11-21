import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { BlankAsNull } from 'src/common/validation/trim';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

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

  @ApiPropertyOptional({ example: '12 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh' })
  @BlankAsNull()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  address?: string | null;

  @ApiPropertyOptional({ example: '0319876543' })
  @BlankAsNull()
  @IsString()
  @MaxLength(50)
  @IsOptional()
  taxCode?: string | null;

  @ApiPropertyOptional({ example: '0987654321 - Ngân hàng TMCP Á Châu, CN Quận 1' })
  @BlankAsNull()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  bankAccount?: string | null;

  @ApiPropertyOptional({ example: 'Giám đốc', description: 'Title of the representative on the contract.' })
  @BlankAsNull()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  representativeTitle?: string | null;
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

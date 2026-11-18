import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { BlankAsNull } from 'src/common/validation/trim';

/** Bên A of the MF-1 production contract, as the Admin keeps it; an emptied field prints as a blank to fill in. */
export class ContractPartySettingsDto {
  @ApiPropertyOptional({ example: 'Công ty TNHH Nền tảng Phim AI Cinema' })
  @BlankAsNull()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  contractCompanyName?: string | null;

  @ApiPropertyOptional({ example: 'Lô E2a-7, Đường D1, Khu Công nghệ cao, TP. Thủ Đức' })
  @BlankAsNull()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  contractAddress?: string | null;

  @ApiPropertyOptional({ example: '0312345678' })
  @BlankAsNull()
  @IsString()
  @MaxLength(50)
  @IsOptional()
  contractTaxCode?: string | null;

  @ApiPropertyOptional({ example: '028 0000 0001' })
  @BlankAsNull()
  @IsString()
  @MaxLength(30)
  @IsOptional()
  contractPhone?: string | null;

  @ApiPropertyOptional({ example: 'legal@aicinema.vn' })
  @BlankAsNull()
  @IsEmail()
  @MaxLength(255)
  @IsOptional()
  contractEmail?: string | null;

  @ApiPropertyOptional({ example: '0123456789 - Ngân hàng TMCP Ngoại thương, CN TP. HCM' })
  @BlankAsNull()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  contractBankAccount?: string | null;

  @ApiPropertyOptional({ example: 'Nguyễn Văn An' })
  @BlankAsNull()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  contractRepresentative?: string | null;

  @ApiPropertyOptional({ example: 'Giám đốc' })
  @BlankAsNull()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  contractRepresentativeTitle?: string | null;

  @ApiPropertyOptional({
    example: 'Thành phố Hồ Chí Minh',
    description: 'Where contracts are signed and disputes settled.',
  })
  @BlankAsNull()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  contractPlace?: string | null;
}

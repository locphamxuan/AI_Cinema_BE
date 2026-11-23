import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

/** Spaces, dots and dashes a person types to group the digits of an account number. */
const DigitsOnly = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s.-]/g, '') : value));

/**
 * The legal profile a studio fills in itself on Studio Web (MF-1, 22/11/2026): Bên B of every contract it signs.
 * All fields are required; the studio name, contract email, representative and phone stay with the Admin.
 */
export class UpdateStudioLegalProfileRequestDto {
  @ApiProperty({ example: '12 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh' })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  address: string;

  @ApiProperty({ example: '0319876543', description: '10 digits, or 10 digits, "-" and 3 digits for a branch' })
  @Trim()
  @Matches(/^\d{10}(-\d{3})?$/, { message: 'taxCode must be 10 digits, or 10 digits followed by "-" and 3 digits' })
  taxCode: string;

  @ApiProperty({ example: '0987654321', description: '6 to 19 digits; spaces, dots and dashes are removed' })
  @DigitsOnly()
  @Matches(/^\d{6,19}$/, { message: 'bankAccount must be 6 to 19 digits' })
  bankAccount: string;

  @ApiProperty({ example: 'Ngân hàng TMCP Á Châu (ACB), CN Quận 1' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  bankName: string;

  @ApiProperty({ example: 'Giám đốc', description: 'Title of the representative who signs the contract' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  representativeTitle: string;
}

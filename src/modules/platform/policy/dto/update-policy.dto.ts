import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { PolicyType } from '@prisma/client';
import { BlankAsNull, Trim } from 'src/common/validation/trim';
import { POLICY_CONTENT_MAX } from './create-policy.dto';

/** Validated only when sent; unlike IsOptional, null is refused (the column cannot be cleared). */
const IfSent = () => ValidateIf((_dto: object, value: unknown) => value !== undefined);

/** Any field of the create body. Name, type, version and content can be changed but not cleared. */
export class UpdatePolicyDto {
  @ApiPropertyOptional()
  @IfSent()
  @Trim()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ enum: PolicyType })
  @IfSent()
  @IsEnum(PolicyType)
  type?: PolicyType;

  @ApiPropertyOptional()
  @IfSent()
  @Trim()
  @IsString()
  @Length(1, 50)
  version?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @BlankAsNull()
  @IsString()
  @MaxLength(1000)
  documentReference?: string | null;

  @ApiPropertyOptional({ description: 'Plain text; line breaks and "- " bullets are kept.' })
  @IfSent()
  @Trim()
  @IsString()
  @Length(1, POLICY_CONTENT_MAX)
  content?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IfSent()
  @IsBoolean()
  isActive?: boolean;
}

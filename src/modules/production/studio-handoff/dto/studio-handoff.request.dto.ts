import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StudioMilestoneStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { IsVnd } from 'src/modules/production/production-cost/dto/vnd';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * The studio of a hand-off is typed by hand (name + email, which find or create the studio) or, for a
 * studio already on record, named by `studioId`. A known email reuses that studio.
 */
class StudioChoiceDto {
  @ApiPropertyOptional({ description: "A studio already on record; defaults to the project's studio (BR-59)." })
  @IsUUID('4')
  @IsOptional()
  studioId?: string;

  @ApiPropertyOptional({ example: 'Studio Ánh Trăng', description: 'Typed by hand; required when the email is new.' })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @IsOptional()
  studioName?: string;

  @ApiPropertyOptional({ example: 'contact@anhtrang.studio', description: 'Where the brief is emailed.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  @IsOptional()
  studioEmail?: string;

  @ApiPropertyOptional({ example: '0901 234 567' })
  @Transform(trimmed)
  @Matches(/^[0-9+().\s-]{6,30}$/, { message: 'studioPhone must be a phone number' })
  @IsOptional()
  studioPhone?: string;
}

/** Sent as multipart so the new brief can carry its material: `scripts` and `references` files (BR-59). */
export class ChangeStudioRequestDto extends StudioChoiceDto {
  @ApiPropertyOptional({ description: 'Season whose hand-off is replaced; omitted = the whole-project hand-off.' })
  @IsUUID('4')
  @IsOptional()
  seasonId?: string;

  @ApiProperty({ example: 'The first studio missed two deadlines.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;

  @ApiProperty({ example: 150_000_000, description: 'Production fee (VND) the brief offers the new studio.' })
  @IsVnd()
  offeredFeeVnd: number;

  @ApiPropertyOptional({
    example: 20_000_000,
    description:
      'VND already spent on the replaced studio (paid, or owed as compensation); the rest of its fee returns to the budget. Defaults to 0.',
  })
  @IsVnd(0)
  @IsOptional()
  forfeitedVnd?: number;
}

/** The milestones a Creator can move a hand-off to; the rest are set by the system (BR-58). */
export const CREATOR_MILESTONES = [
  StudioMilestoneStatus.STUDIO_ACCEPTED,
  StudioMilestoneStatus.IN_PROGRESS,
  StudioMilestoneStatus.DELIVERED,
  StudioMilestoneStatus.STUDIO_DECLINED,
] as const;

export class UpdateMilestoneRequestDto {
  @ApiProperty({ enum: CREATOR_MILESTONES })
  @IsIn(CREATOR_MILESTONES)
  status: (typeof CREATOR_MILESTONES)[number];

  @ApiPropertyOptional({ example: 'Studio gửi bản dựng qua email ngày 20/10.', description: 'Required to decline.' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  note?: string;

  @ApiPropertyOptional({ description: 'Required for DELIVERED: the Submission the Creator uploaded from the studio.' })
  @IsUUID('4')
  @IsOptional()
  mediaAssetId?: string;
}

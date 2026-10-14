import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StudioMilestoneStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Step 3, sent as multipart so the hand-off can carry its material: `scripts` and `references` files go
 * to the studio with the brief (BR-59). Without `seasonId` the whole project is handed off.
 */
export class HandOffRequestDto {
  @ApiPropertyOptional({ description: "Studio from the catalog; defaults to the project's studio (BR-59)." })
  @IsUUID('4')
  @IsOptional()
  studioId?: string;

  @ApiPropertyOptional({ description: 'Hand off one season only; omitted = every episode not handed off yet.' })
  @IsUUID('4')
  @IsOptional()
  seasonId?: string;
}

export class ChangeStudioRequestDto {
  @ApiProperty({ description: 'The studio taking over, from the catalog.' })
  @IsUUID('4')
  studioId: string;

  @ApiPropertyOptional({ description: 'Season whose hand-off is replaced; omitted = the whole-project hand-off.' })
  @IsUUID('4')
  @IsOptional()
  seasonId?: string;

  @ApiProperty({ example: 'The first studio missed two deadlines.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
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

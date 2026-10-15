import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';
import { AdStatus } from '@prisma/client';

/** One mid-roll cue of a session, with the ad the player shows when it gets there. */
export class AdScheduleItemDto {
  @ApiProperty({ example: 'c31d...' })
  breakId: string;

  @ApiProperty({ example: 600, description: 'Cue point in seconds from the episode start' })
  positionSeconds: number;

  @ApiProperty({ example: { id: 'a1...', title: 'Trà sữa', mediaUrl: 'https://...', durationSeconds: 15 } })
  ad: { id: string; title: string; mediaUrl: string; clickUrl: string | null; durationSeconds: number };
}

/** What marking a break played hands back; doubles as the impression record. */
export class AdBreakPlayedViewDto {
  @ApiProperty({ example: 'c31d...' })
  breakId: string;

  @ApiProperty({ example: 'PLAYED' })
  status: string;

  @ApiProperty({ example: '2026-10-15T10:00:00.000Z', nullable: true })
  playedAt: Date | null;
}

export class CreateAdRequestDto {
  @ApiProperty({ example: 'Trà sữa Gong Cha — mua 1 tặng 1' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'https://cdn.aicinema.example/public/ads/gongcha-15s.mp4' })
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  mediaUrl: string;

  @ApiPropertyOptional({ example: 'https://gongcha.example/promo' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  clickUrl?: string;

  @ApiProperty({ example: 15 })
  @IsInt()
  @Min(1)
  durationSeconds: number;

  @ApiPropertyOptional({ example: 3, description: 'Pick weight for the mid-roll draw; higher shows more often' })
  @IsOptional()
  @IsInt()
  @Min(1)
  weight?: number;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date;
}

export class UpdateAdRequestDto {
  @ApiPropertyOptional({ example: 'Trà sữa Gong Cha — mua 1 tặng 1' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ example: 'https://cdn.aicinema.example/public/ads/gongcha-15s.mp4' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  mediaUrl?: string;

  @ApiPropertyOptional({ example: 'https://gongcha.example/promo' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  clickUrl?: string | null;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  weight?: number;

  @ApiPropertyOptional({ enum: AdStatus, example: 'PAUSED' })
  @IsOptional()
  @IsEnum(AdStatus)
  status?: AdStatus;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date | null;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date | null;
}

export class AdViewDto {
  @ApiProperty({ example: 'a1...' })
  id: string;

  @ApiProperty({ example: 'Trà sữa Gong Cha — mua 1 tặng 1' })
  title: string;

  @ApiProperty({ example: 'https://cdn.aicinema.example/public/ads/gongcha-15s.mp4' })
  mediaUrl: string;

  @ApiProperty({ example: null, nullable: true })
  clickUrl: string | null;

  @ApiProperty({ example: 15 })
  durationSeconds: number;

  @ApiProperty({ example: 3 })
  weight: number;

  @ApiProperty({ enum: AdStatus, example: 'ACTIVE' })
  status: AdStatus;
}

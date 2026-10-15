import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, IsUrl, IsInt, Min, IsEnum, IsDate } from 'class-validator';

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

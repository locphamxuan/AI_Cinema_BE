import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

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

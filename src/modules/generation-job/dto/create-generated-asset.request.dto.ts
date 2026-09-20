import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AssetType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGeneratedAssetRequestDto {
  @ApiProperty({ example: 'SUBTITLE', description: 'Type of generated artifact.', enum: AssetType })
  @IsEnum(AssetType)
  assetType: AssetType;

  @ApiPropertyOptional({ example: 'vi', description: 'BCP-47 language of the asset (text/audio).' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ example: 'Xin chào...', description: 'Text content for SCRIPT/SUBTITLE assets.' })
  @IsString()
  @IsOptional()
  contentText?: string;

  @ApiPropertyOptional({ example: 's3://bucket/vi/2302.mp4', description: 'Object-storage key of the file.' })
  @IsString()
  @IsOptional()
  storageKey?: string;

  @ApiPropertyOptional({ example: 'video/mp4', description: 'MIME type of the file.' })
  @IsString()
  @IsOptional()
  mimeType?: string;

  @ApiPropertyOptional({ example: 1572864, description: 'File size in bytes.' })
  @IsInt()
  @Min(0)
  @IsOptional()
  fileSizeBytes?: number;

  @ApiPropertyOptional({ example: 'a1b2...', description: 'SHA-256 checksum of the file.' })
  @IsString()
  @IsOptional()
  checksumSha256?: string;

  @ApiPropertyOptional({ example: 120, description: 'Duration of audio/video assets in seconds.' })
  @IsInt()
  @Min(0)
  @IsOptional()
  durationSeconds?: number;

  @ApiPropertyOptional({ example: '1920x1080', description: 'Resolution of video/poster assets.' })
  @IsString()
  @IsOptional()
  resolution?: string;

  @ApiPropertyOptional({ description: 'Free-form metadata of the asset.' })
  @IsString()
  @IsOptional()
  metadata?: string;
}
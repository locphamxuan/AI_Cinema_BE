import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

export class UpdateAdRequestDto {
  @ApiPropertyOptional({ example: 'Trà sữa Gong Cha — mua 1 tặng 1' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ example: 'https://cdn.aicinema.example/public/ads/gongcha-15s.mp4' })
  @IsOptional()
  // An uploaded video is served by the API itself with local storage (http://localhost:3001/media/public/ads/…).
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(1000)
  mediaUrl?: string;

  @ApiPropertyOptional({ enum: AdStatus, example: 'PAUSED' })
  @IsOptional()
  @IsEnum(AdStatus)
  status?: AdStatus;
}

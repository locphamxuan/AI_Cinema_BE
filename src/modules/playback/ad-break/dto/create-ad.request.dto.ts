import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { MAX_AD_WEIGHT } from '../ad-limits';

export class CreateAdRequestDto {
  @ApiProperty({ example: 'Trà sữa Gong Cha — mua 1 tặng 1' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example: 'https://cdn.aicinema.example/public/ads/gongcha-15s.mp4',
    description: 'Direct link to the MP4; its length is read from the file',
  })
  // An uploaded video is served by the API itself with local storage (http://localhost:3001/media/public/ads/…).
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(1000)
  mediaUrl: string;

  @ApiPropertyOptional({ example: 'https://gongcha.example/promo' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  clickUrl?: string;

  @ApiPropertyOptional({
    example: 3,
    maximum: MAX_AD_WEIGHT,
    description: 'Pick weight for the mid-roll draw; higher shows more often',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_AD_WEIGHT)
  weight?: number;
}

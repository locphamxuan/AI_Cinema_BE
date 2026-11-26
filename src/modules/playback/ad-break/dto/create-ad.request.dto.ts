import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';

export class CreateAdRequestDto {
  @ApiProperty({ example: 'Trà sữa Gong Cha — mua 1 tặng 1' })
  @Trim()
  @IsString()
  @MinLength(1)
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
}

import { ApiProperty } from '@nestjs/swagger';

export class CreateWatchRoomDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  episodeId: string;
}

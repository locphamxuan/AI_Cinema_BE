import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Main Flow 3, step 11: ask for a streaming session for an episode access was granted for. */
export class CreateStreamingSessionRequestDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33', description: 'Episode to play' })
  @IsUUID(4)
  episodeId: string;
}

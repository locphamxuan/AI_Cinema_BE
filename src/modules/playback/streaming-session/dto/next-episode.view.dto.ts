import { ApiProperty } from '@nestjs/swagger';

/** The episode after this one; the client takes it back to Main Flow 2 for access. */
export class NextEpisodeViewDto {
  @ApiProperty({ example: '3a71f0d4-9c22-4c6b-8f31-1a2b3c4d5e6f' })
  movieId: string;

  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33', nullable: true })
  episodeId: string | null;

  @ApiProperty({ example: 6, nullable: true })
  episodeNumber: number | null;

  @ApiProperty({ example: 'Tập 6: Bình minh', nullable: true })
  title: string | null;
}

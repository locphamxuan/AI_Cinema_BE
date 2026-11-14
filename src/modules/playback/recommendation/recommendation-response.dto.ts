import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecommendationResponseDto {
  @ApiProperty({ example: '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33' })
  movieId: string;

  @ApiProperty({ example: 'The Last Starlight' })
  title: string;

  @ApiPropertyOptional({ example: 'P', description: 'Age rating after the age gate' })
  ageRating?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/posters/m1.jpg' })
  posterUrl?: string | null;

  @ApiProperty({ example: 0.87, description: 'Hybrid score, 0..1' })
  score: number;

  @ApiProperty({ enum: ['hybrid', 'trending', 'similar', 'after'] })
  source: string;

  @ApiPropertyOptional({ example: 'Hợp gu Hành động bạn hay xem', description: 'Why the movie is suggested' })
  reason?: string | null;

  constructor(partial: Partial<RecommendationResponseDto>) {
    Object.assign(this, partial);
  }

  static from(
    movie: { id: string; title: string; ageRating: string | null; posterUrl?: string | null },
    score: number,
    source: string,
    reason: string | null = null,
  ): RecommendationResponseDto {
    return new RecommendationResponseDto({
      movieId: movie.id,
      title: movie.title,
      ageRating: movie.ageRating,
      posterUrl: movie.posterUrl ?? null,
      score: Math.round(score * 1000) / 1000,
      source,
      reason,
    });
  }
}

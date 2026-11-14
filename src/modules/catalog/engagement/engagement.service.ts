import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { LISTED_MOVIE } from '../catalog.service';
import { VISIBLE_EPISODE } from '../episode-visibility';

/** A signed-in viewer's plays of one episode count once in this window. */
const VIEW_WINDOW_MS = 30 * 60 * 1000;

export interface MovieEngagement {
  likeCount: number;
  viewCount: number;
  /** Null for a Guest. */
  likedByMe: boolean | null;
}

/** Hearts on movies and plays of episodes: what viewers see under a movie and what the Admin reports on. */
@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(movieId: string, userId?: string): Promise<MovieEngagement> {
    await this.assertListed(movieId);
    const [likeCount, viewCount, mine] = await Promise.all([
      this.prisma.movieLike.count({ where: { movieId } }),
      this.prisma.episodeView.count({ where: { episode: { movieId } } }),
      userId ? this.prisma.movieLike.count({ where: { movieId, userId } }) : Promise.resolve(null),
    ]);
    return { likeCount, viewCount, likedByMe: mine === null ? null : mine > 0 };
  }

  /** Liking twice changes nothing. */
  async like(movieId: string, userId: string): Promise<MovieEngagement> {
    await this.assertListed(movieId);
    await this.prisma.movieLike.upsert({
      where: { userId_movieId: { userId, movieId } },
      update: {},
      create: { userId, movieId },
    });
    return this.summary(movieId, userId);
  }

  async unlike(movieId: string, userId: string): Promise<MovieEngagement> {
    await this.assertListed(movieId);
    await this.prisma.movieLike.deleteMany({ where: { movieId, userId } });
    return this.summary(movieId, userId);
  }

  /** Counts a play that started; a signed-in viewer restarting within VIEW_WINDOW_MS is not counted again. */
  async recordView(episodeId: string, userId?: string): Promise<{ counted: boolean; viewCount: number }> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, ...VISIBLE_EPISODE },
      select: { id: true },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    const recent = userId
      ? await this.prisma.episodeView.count({
          where: { episodeId, userId, createdAt: { gte: new Date(Date.now() - VIEW_WINDOW_MS) } },
        })
      : 0;
    if (!recent) await this.prisma.episodeView.create({ data: { episodeId, userId } });
    return { counted: !recent, viewCount: await this.prisma.episodeView.count({ where: { episodeId } }) };
  }

  private async assertListed(movieId: string) {
    if (!(await this.prisma.movie.count({ where: { id: movieId, ...LISTED_MOVIE } }))) {
      throw new NotFoundException('Movie not found');
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { GENRES, LISTED_MOVIE, movieCard } from '../catalog.service';

/** A Member's "Danh sách của tôi": movies kept to watch later, newest first. */
@Injectable()
export class SavedMovieService {
  constructor(private readonly prisma: PrismaService) {}

  /** Only movies still on the platform; a cancelled one drops out of the list without being deleted. */
  async list(userId: string) {
    const rows = await this.prisma.savedMovie.findMany({
      where: { userId, movie: LISTED_MOVIE },
      orderBy: { createdAt: 'desc' },
      include: { movie: { include: GENRES } },
    });
    return rows.map(({ movie, createdAt }) => ({ ...movieCard(movie), savedAt: createdAt }));
  }

  async isSaved(movieId: string, userId: string): Promise<{ saved: boolean }> {
    const count = await this.prisma.savedMovie.count({ where: { movieId, userId } });
    return { saved: count > 0 };
  }

  /** Saving twice changes nothing. */
  async save(movieId: string, userId: string): Promise<{ saved: boolean }> {
    if (!(await this.prisma.movie.count({ where: { id: movieId, ...LISTED_MOVIE } }))) {
      throw new NotFoundException('Movie not found');
    }
    await this.prisma.savedMovie.upsert({
      where: { userId_movieId: { userId, movieId } },
      update: {},
      create: { userId, movieId },
    });
    return { saved: true };
  }

  async unsave(movieId: string, userId: string): Promise<{ saved: boolean }> {
    await this.prisma.savedMovie.deleteMany({ where: { movieId, userId } });
    return { saved: false };
  }
}

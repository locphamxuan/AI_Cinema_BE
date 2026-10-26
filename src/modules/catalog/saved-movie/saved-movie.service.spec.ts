import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { SavedMovieService } from './saved-movie.service';

describe('SavedMovieService', () => {
  const prisma = {
    movie: { count: jest.fn() },
    savedMovie: { findMany: jest.fn(), count: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  };
  const service = new SavedMovieService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.movie.count.mockResolvedValue(1);
  });

  it('lists only movies still on the platform as catalog cards, newest first', async () => {
    const savedAt = new Date('2026-10-27T03:00:00Z');
    prisma.savedMovie.findMany.mockResolvedValue([
      {
        createdAt: savedAt,
        movie: { id: 'm1', title: 'Vùng dịch', genres: [{ genre: { id: 'g1', name: 'Kinh dị' } }] },
      },
    ]);

    const list = await service.list('u1');

    expect(prisma.savedMovie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', movie: expect.any(Object) }),
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(list).toEqual([
      expect.objectContaining({ id: 'm1', title: 'Vùng dịch', genres: [{ id: 'g1', name: 'Kinh dị' }], savedAt }),
    ]);
  });

  it('keeps one row per Member however often they save', async () => {
    expect(await service.save('m1', 'u1')).toEqual({ saved: true });
    expect(prisma.savedMovie.upsert).toHaveBeenCalledWith({
      where: { userId_movieId: { userId: 'u1', movieId: 'm1' } },
      update: {},
      create: { userId: 'u1', movieId: 'm1' },
    });
  });

  it('refuses to save a movie that is not on the platform', async () => {
    prisma.movie.count.mockResolvedValue(0);
    await expect(service.save('gone', 'u1')).rejects.toThrow(NotFoundException);
    expect(prisma.savedMovie.upsert).not.toHaveBeenCalled();
  });

  it('answers whether the Member saved the movie, and unsaving twice is harmless', async () => {
    prisma.savedMovie.count.mockResolvedValue(1);
    expect(await service.isSaved('m1', 'u1')).toEqual({ saved: true });

    expect(await service.unsave('m1', 'u1')).toEqual({ saved: false });
    expect(await service.unsave('m1', 'u1')).toEqual({ saved: false });
    expect(prisma.savedMovie.deleteMany).toHaveBeenCalledWith({ where: { movieId: 'm1', userId: 'u1' } });
  });
});

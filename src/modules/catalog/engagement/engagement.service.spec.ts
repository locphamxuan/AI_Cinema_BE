import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { EngagementService } from './engagement.service';

describe('EngagementService', () => {
  const prisma = {
    movie: { count: jest.fn() },
    episode: { findFirst: jest.fn() },
    movieLike: { count: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    episodeView: { count: jest.fn(), create: jest.fn() },
  };
  const service = new EngagementService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.movie.count.mockResolvedValue(1);
  });

  it('tells a Guest the counts and a Member whether they gave a heart', async () => {
    prisma.movieLike.count.mockResolvedValueOnce(7);
    prisma.episodeView.count.mockResolvedValueOnce(120);
    expect(await service.summary('m1')).toEqual({ likeCount: 7, viewCount: 120, likedByMe: null });

    prisma.movieLike.count.mockResolvedValueOnce(7).mockResolvedValueOnce(1);
    prisma.episodeView.count.mockResolvedValueOnce(120);
    expect(await service.summary('m1', 'u1')).toMatchObject({ likedByMe: true });
  });

  it('keeps one heart per Member however often they press it', async () => {
    prisma.movieLike.count.mockResolvedValue(1);
    prisma.episodeView.count.mockResolvedValue(0);
    await service.like('m1', 'u1');
    expect(prisma.movieLike.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_movieId: { userId: 'u1', movieId: 'm1' } }, update: {} }),
    );
  });

  it('refuses a movie that is not on the platform', async () => {
    prisma.movie.count.mockResolvedValue(0);
    await expect(service.like('gone', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('counts a signed-in viewer once per episode in 30 minutes, every Guest play', async () => {
    prisma.episode.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.episodeView.count.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    expect(await service.recordView('e1', 'u1')).toEqual({ counted: false, viewCount: 5 });
    expect(prisma.episodeView.create).not.toHaveBeenCalled();

    prisma.episodeView.count.mockResolvedValueOnce(6);
    expect(await service.recordView('e1')).toEqual({ counted: true, viewCount: 6 });
    expect(prisma.episodeView.create).toHaveBeenCalledWith({ data: { episodeId: 'e1', userId: undefined } });
  });
});

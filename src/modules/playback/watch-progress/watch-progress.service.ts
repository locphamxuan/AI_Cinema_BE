import { Injectable } from '@nestjs/common';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { HistoryItemDto } from 'src/modules/playback/watch-progress/dto/history-item.dto';
import { ProgressViewDto } from 'src/modules/playback/watch-progress/dto/progress.view.dto';

/**
 * Saved resume positions (flow 3, steps 8–10, 20): one row per (member, episode).
 * Guests have no row and always restart from 0.
 */
@Injectable()
export class WatchProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /** Step 8: the member's saved position, or a blank answer when never opened. */
  async progress(userId: string, episodeId: string): Promise<ProgressViewDto> {
    const row = await this.prisma.watchProgress.findUnique({
      where: { userId_episodeId: { userId, episodeId } },
    });
    if (!row) {
      return {
        episodeId,
        found: false,
        positionSeconds: 0,
        durationSeconds: null,
        completed: false,
        completedAt: null,
        lastWatchedAt: null,
      };
    }
    return {
      episodeId,
      found: true,
      positionSeconds: row.positionSeconds,
      durationSeconds: row.durationSeconds,
      completed: row.completed,
      completedAt: row.completedAt,
      lastWatchedAt: row.lastWatchedAt,
    };
  }

  /** Persist one viewing update; called by heartbeats, stops and completions. */
  async save(
    userId: string,
    episodeId: string,
    input: { positionSeconds: number; durationSeconds: number | null; completed: boolean; at: Date },
  ): Promise<void> {
    const existing = await this.prisma.watchProgress.findUnique({
      where: { userId_episodeId: { userId, episodeId } },
    });
    if (!existing) {
      await this.prisma.watchProgress.create({
        data: {
          userId,
          episodeId,
          positionSeconds: input.positionSeconds,
          durationSeconds: input.durationSeconds,
          completed: input.completed,
          completedAt: input.completed ? input.at : null,
          lastWatchedAt: input.at,
        },
      });
      return;
    }
    await this.prisma.watchProgress.update({
      where: { id: existing.id },
      data: {
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        // Completion sticks: replaying from an earlier point never un-completes.
        completed: existing.completed || input.completed,
        completedAt: existing.completedAt ?? (input.completed ? input.at : null),
        lastWatchedAt: input.at,
      },
    });
  }

  /** Continue-watching list, newest first. */
  async history(userId: string, query: PaginateQuery) {
    const page = await paginate(query, this.prisma.watchProgress, {
      where: { userId },
      relations: {
        episode: { include: { movie: { select: { id: true, title: true } } } },
      },
      sortableColumns: ['lastWatchedAt', 'createdAt'],
      defaultSortBy: [['lastWatchedAt', 'DESC']],
    });
    return { ...page, data: (page.data as unknown as HistoryRow[]).map(historyItem) };
  }
}

type HistoryRow = {
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  lastWatchedAt: Date;
  episode: {
    id: string;
    title: string;
    episodeNumber: number;
    thumbnailUrl: string | null;
    movieId: string;
    movie: { title: string };
  };
};

function historyItem(row: HistoryRow): HistoryItemDto {
  return {
    episodeId: row.episode.id,
    episodeTitle: row.episode.title,
    episodeNumber: row.episode.episodeNumber,
    thumbnailUrl: row.episode.thumbnailUrl,
    movieId: row.episode.movieId,
    movieTitle: row.episode.movie.title,
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    completed: row.completed,
    lastWatchedAt: row.lastWatchedAt,
  };
}

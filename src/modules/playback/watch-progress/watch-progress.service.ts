import { Injectable } from '@nestjs/common';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { Prisma, type EpisodeStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { playbackAvailability } from 'src/modules/catalog/episode-visibility';
import { HistoryItemDto } from 'src/modules/playback/watch-progress/dto/history-item.dto';
import { ProgressViewDto } from 'src/modules/playback/watch-progress/dto/progress.view.dto';

interface ProgressSaveInput {
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  at: Date;
}

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
  async save(userId: string, episodeId: string, input: ProgressSaveInput): Promise<void> {
    const where = { userId_episodeId: { userId, episodeId } };
    const existing = await this.prisma.watchProgress.findUnique({ where });
    if (existing) {
      await this.applyUpdate(existing, input);
      return;
    }
    try {
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
    } catch (error) {
      // P3-1: two tabs can both miss the row and race the insert. The loser re-reads the row the
      // winner created and applies its update to it, instead of surfacing P2002 as a 500.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      const winner = await this.prisma.watchProgress.findUnique({ where });
      if (!winner) throw error;
      await this.applyUpdate(winner, input);
    }
  }

  private async applyUpdate(
    existing: { id: string; completed: boolean; completedAt: Date | null },
    input: ProgressSaveInput,
  ): Promise<void> {
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

  /** Continue-watching list, newest first. Removed episodes stay, flagged unavailable (P3-4). */
  async history(userId: string, query: PaginateQuery) {
    const page = await paginate(query, this.prisma.watchProgress, {
      where: { userId },
      relations: {
        episode: {
          select: {
            id: true,
            title: true,
            episodeNumber: true,
            thumbnailUrl: true,
            movieId: true,
            // P3-4: enough to answer whether the row can still be opened.
            status: true,
            revisionStartedAt: true,
            movie: { select: { title: true } },
          },
        },
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
    status: EpisodeStatus;
    revisionStartedAt: Date | null;
    movie: { title: string };
  };
};

/** Maps one row; exported so the availability rules stay under test without the HTTP stack. */
export function historyItem(row: HistoryRow): HistoryItemDto {
  const { available, notice } = playbackAvailability(row.episode);
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
    available,
    notice,
  };
}

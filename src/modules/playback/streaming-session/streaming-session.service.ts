import { BadRequestException, Injectable } from '@nestjs/common';
import { StreamingSessionStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { DeviceEligibilityPort } from '../playback-access/device-eligibility.port';
import { PlaybackAccessService } from '../playback-access/playback-access.service';
import type { StreamingSessionViewDto } from './dto/streaming-session.dto';

export interface CreateSessionInput {
  episodeId: string;
  userId?: string;
  guestKey?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Main Flow 3, step 11 (phase 1): verifies playback access, checks the device
 * slot and opens a streaming session. Guests always start from 0 and carry
 * guestKey; members carry userId. Saved-progress resume lands in a later phase.
 */
@Injectable()
export class StreamingSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlaybackAccessService,
    private readonly devices: DeviceEligibilityPort,
    private readonly settings: PlatformSettingService,
  ) {}

  async create(input: CreateSessionInput): Promise<StreamingSessionViewDto> {
    const { userId, guestKey } = input;
    if (!userId && !guestKey) {
      throw new BadRequestException({
        message: 'Guests must send X-Guest-Key',
        details: { reason: 'GUEST_KEY_REQUIRED' },
      });
    }
    if (userId && guestKey) {
      throw new BadRequestException({
        message: 'A session belongs to either a member or a guest, never both',
        details: { reason: 'OWNER_CONFLICT' },
      });
    }
    if (guestKey && !UUID_V4.test(guestKey)) {
      throw new BadRequestException({
        message: 'X-Guest-Key must be a UUID v4',
        details: { reason: 'GUEST_KEY_INVALID' },
      });
    }

    const verified = await this.access.verify(input.episodeId, userId);
    if (userId) await this.devices.check(userId);

    // Double taps share one live session: an ACTIVE row on the same episode whose
    // heartbeat has not timed out is handed back instead of opening a second row.
    const { playbackHeartbeatTimeoutSeconds } = await this.settings.get();
    const aliveSince = new Date(Date.now() - playbackHeartbeatTimeoutSeconds * 1000);
    const live = await this.prisma.streamingSession.findFirst({
      where: {
        episodeId: input.episodeId,
        status: StreamingSessionStatus.ACTIVE,
        lastHeartbeatAt: { gt: aliveSince },
        ...(userId ? { userId } : { guestKey }),
      },
      orderBy: { startedAt: 'desc' },
    });
    if (live) return this.view(live, verified, true);

    const created = await this.prisma.streamingSession.create({
      data: {
        userId: userId ?? null,
        guestKey: guestKey ?? null,
        episodeId: verified.episodeId,
        mediaAssetId: verified.mediaAssetId,
        accessType: verified.accessType,
        status: StreamingSessionStatus.ACTIVE,
        startPositionSeconds: 0,
        lastPositionSeconds: 0,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
      },
    });
    return this.view(created, verified, false);
  }

  private view(
    session: {
      id: string;
      status: StreamingSessionStatus;
      startPositionSeconds: number;
    },
    verified: {
      episodeId: string;
      movieId: string;
      streamUrl: string;
      qualities: string[];
      durationSeconds: number | null;
      accessType: string;
      planCode: string | null;
      subtitles: { language: string; fileUrl: string; isDefault: boolean }[];
      aiLabel: { type: string; text: string; displayLocation: string | null } | null;
    },
    reused: boolean,
  ): StreamingSessionViewDto {
    return {
      sessionId: session.id,
      episodeId: verified.episodeId,
      movieId: verified.movieId,
      accessType: verified.accessType,
      planCode: verified.planCode,
      status: session.status,
      startPositionSeconds: session.startPositionSeconds,
      stream: {
        masterUrl: verified.streamUrl,
        qualities: verified.qualities,
        durationSeconds: verified.durationSeconds,
      },
      subtitles: verified.subtitles.map((subtitle) => ({
        language: subtitle.language,
        url: subtitle.fileUrl,
        isDefault: subtitle.isDefault,
      })),
      aiLabel: verified.aiLabel,
      ...(reused ? { reused: true } : {}),
    };
  }
}

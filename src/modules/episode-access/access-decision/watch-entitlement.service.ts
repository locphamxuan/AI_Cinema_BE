import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AccessDecisionService } from 'src/modules/episode-access/access-decision/access-decision.service';

/**
 * A shared entitlement check for features that hand out a stream URL to a member: the watch room
 * is one of them (BR-69). It reuses the same decision as Main Flow 2 so a room never hands out a
 * stream the member could not get on their own.
 */
@Injectable()
export class WatchEntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessDecisionService,
  ) {}

  /** True when the member may play the episode right now, with the signed URL to use. */
  async canWatch(episodeId: string, userId: string) {
    const decision = await this.access.decide(episodeId, userId);
    return {
      allowed: decision.accessGranted,
      reason: decision.notice ?? decision.nextAction,
      streamUrl: decision.streamUrl,
      required: decision.required,
    };
  }
}
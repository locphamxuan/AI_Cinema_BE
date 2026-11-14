import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SupportAudience, SupportSenderType } from '@prisma/client';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SupportAiUnavailableError } from '../ai/ai-errors';
import { SupportAgentService } from '../ai/support-agent.service';
import { RetrievalService } from '../knowledge/retrieval.service';

export interface PlaygroundInput {
  question: string;
  audience?: SupportAudience;
  locale?: string;
  history?: Array<{ role: 'MEMBER' | 'AI'; content: string }>;
}

/** Excerpt length of a retrieved chunk shown next to the answer. */
const EXCERPT_CHARS = 300;

/**
 * The Admin's AI playground: runs the same grounded agent a member talks to, on a question the Admin types,
 * so a new or edited article can be checked before members rely on it. Nothing is stored and nothing is sent
 * to anyone. The read-only account tools run against the Admin's own account, which has no member data, so
 * questions about "my Coin" come back as "no data" by design.
 */
@Injectable()
export class AiPlaygroundService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly agent: SupportAgentService,
    private readonly settings: PlatformSettingService,
  ) {}

  async previewChat(adminId: string, input: PlaygroundInput) {
    const history = (input.history ?? []).map((turn) => ({
      senderType: turn.role === 'AI' ? SupportSenderType.AI_CHATBOT : SupportSenderType.MEMBER,
      content: turn.content,
    }));
    const query = [...history.slice(-3).map((turn) => turn.content), input.question].join('\n');
    const [retrieved, platformFacts] = await Promise.all([
      this.retrieval.retrieve(query, { audience: input.audience, locale: input.locale }),
      this.platformFacts(),
    ]);

    try {
      const reply = await this.agent.reply({
        conversationId: 'admin-playground',
        memberId: adminId,
        message: input.question,
        history,
        platformFacts,
        retrieved,
        audience: input.audience === SupportAudience.STAFF ? 'STAFF' : 'MEMBER',
      });
      return {
        question: input.question,
        answer: reply.reply,
        resolution: reply.resolution,
        confidence: reply.confidence,
        escalationReason: reply.escalationReason ?? null,
        grounded: retrieved.length > 0,
        sources: reply.metadata.sources,
        retrieved: retrieved.map(({ articleId, title, heading, chunkIndex, score, content }) => ({
          articleId,
          title,
          heading,
          chunkIndex,
          score,
          excerpt: content.length > EXCERPT_CHARS ? `${content.slice(0, EXCERPT_CHARS)}…` : content,
        })),
        toolsUsed: reply.metadata.toolCalls.map((call) => call.name),
        model: reply.metadata.model,
        latencyMs: reply.metadata.latencyMs,
      };
    } catch (error) {
      if (error instanceof SupportAiUnavailableError) {
        throw new ServiceUnavailableException({
          message: 'The AI assistant is not available right now',
          details: { reason: 'AI_UNAVAILABLE', cause: error.cause },
        });
      }
      throw error;
    }
  }

  private async platformFacts(): Promise<Record<string, unknown>> {
    const s = await this.settings.get();
    return {
      coinRateVnd: s.coinRateVnd,
      bonusCoinExpiryDays: s.bonusCoinExpiryDays,
      subscriptionCancelWindowHours: s.subscriptionCancelWindowHours,
      refundOnRemoval: s.refundOnRemoval,
    };
  }
}

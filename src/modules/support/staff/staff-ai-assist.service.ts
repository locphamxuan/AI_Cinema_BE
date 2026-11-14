import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SupportAudience, SupportSenderType } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SupportAiUnavailableError } from '../ai/ai-errors';
import { SupportAgentService } from '../ai/support-agent.service';
import { SupportMessageService } from '../chat/support-message.service';
import { RetrievalService } from '../knowledge/retrieval.service';

/** What the Staff member sees next to the reply box; nothing here reaches the member until Staff sends it. */
export interface StaffAiSuggestion {
  conversationId: string;
  draft: string;
  confidence: number;
  /** false when the AI found neither an article nor tool data and answered with the scope message. */
  grounded: boolean;
  sources: { articleId: string; title: string; heading: string }[];
  toolsUsed: string[];
  model: string;
}

/**
 * The AI assistant for Staff (2026-11-12): drafts a reply to a support case from the same grounded agent the
 * member chat uses, but with the Staff-only knowledge articles retrieved too and the read-only tools scoped to
 * the case's member. The draft is returned to the Staff member and never stored or sent on its own.
 */
@Injectable()
export class StaffAiAssistService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly messages: SupportMessageService,
    private readonly retrieval: RetrievalService,
    private readonly agent: SupportAgentService,
    private readonly settings: PlatformSettingService,
  ) {}

  async suggest(conversationId: string, question?: string): Promise<StaffAiSuggestion> {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, memberId: true },
    });
    if (!conversation) throw new NotFoundException('Support case not found');

    const history = await this.messages.recentForAi(conversationId, this.config.support.aiHistoryMessages);
    const lastMember = [...history].reverse().find((m) => m.senderType === SupportSenderType.MEMBER)?.content;
    const message = question?.trim() || lastMember;
    if (!message) {
      throw new UnprocessableEntityException({
        message: 'There is no member message to answer yet; ask the assistant a question instead',
        details: { reason: 'NOTHING_TO_ANSWER' },
      });
    }
    const query = [...history.slice(-3).map((m) => m.content), question ?? ''].join('\n');
    const [retrieved, platformFacts] = await Promise.all([
      this.retrieval.retrieve(query, { audience: SupportAudience.STAFF }),
      this.platformFacts(),
    ]);

    try {
      const reply = await this.agent.reply({
        conversationId,
        memberId: conversation.memberId,
        message,
        history: history.map(({ senderType, content }) => ({ senderType, content })),
        platformFacts,
        retrieved,
        audience: 'STAFF',
      });
      const toolsUsed = reply.metadata.toolCalls.map((call) => call.name);
      const toolData = reply.metadata.toolCalls.some((c) => (c.result as { ok?: boolean } | null)?.ok === true);
      return {
        conversationId,
        draft: reply.reply,
        confidence: reply.confidence,
        grounded: retrieved.length > 0 || toolData,
        sources: reply.metadata.sources,
        toolsUsed,
        model: reply.metadata.model,
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

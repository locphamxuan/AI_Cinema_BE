import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, SupportEscalationReason, SupportMessage, SupportSenderType } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SupportAgentService, type SupportAgentReply } from '../ai/support-agent.service';
import { SupportAiUnavailableError } from '../ai/ai-errors';
import { ESCALATION_REASON_LABEL } from '../shared/support-reason';
import { HandoffSummaryAiService } from '../ai/handoff-summary-ai.service';
import { SummaryService } from '../ai/summary.service';
import { RetrievalService } from '../knowledge/retrieval.service';
import { conversationView, escalationText, messageView, quickRepliesFor } from '../shared/support-presenter';
import type { SupportSendResult } from '../shared/support-view';
import { EscalationService } from './escalation.service';
import { SupportConversationService } from './support-conversation.service';
import { SupportMessageService } from './support-message.service';

/**
 * The AI half of a member turn (plan §5.3): retrieval, the agent call, the stored answer and the
 * hand-off to Staff when the assistant fails or is unsure. Kept beside SupportChatService so the
 * chat service only owns the conversation rules.
 */
@Injectable()
export class SupportAiTurnService {
  private readonly logger = new Logger(SupportAiTurnService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly conversations: SupportConversationService,
    private readonly messages: SupportMessageService,
    private readonly agent: SupportAgentService,
    private readonly escalation: EscalationService,
    private readonly retrieval: RetrievalService,
    private readonly summary: SummaryService,
    private readonly settings: PlatformSettingService,
    private readonly handoffAi: HandoffSummaryAiService,
  ) {}

  /** One AI answer for a member message, from retrieval to the stored reply. */
  async run(
    memberId: string,
    conversationId: string,
    content: string,
    memberMessage: SupportMessage,
  ): Promise<SupportSendResult> {
    const history = await this.messages.recentForAi(conversationId, this.config.support.aiHistoryMessages);
    const query = history
      .slice(-3)
      .map((message) => message.content)
      .join('\n');

    const [retrieved, platformFacts] = await Promise.all([
      this.retrieval.retrieve(query, {
        topK: this.config.support.ragTopK,
        minScore: this.config.support.ragMinScore,
        audience: 'MEMBER',
      }),
      this.platformFacts(),
    ]);

    let reply: SupportAgentReply;
    try {
      reply = await this.agent.reply({
        conversationId,
        memberId,
        message: content,
        history: history.map(({ senderType, content: line }) => ({ senderType, content: line })),
        platformFacts,
        retrieved,
      });
    } catch (error) {
      if (error instanceof SupportAiUnavailableError) {
        return this.escalateAfterAiFailure(conversationId, memberMessage, history, error.cause);
      }
      const failures = await this.conversations.recordAiFailure(conversationId);
      // Provider errors are logged by request shape only, never their content (plan §8.2).
      this.logger.warn(`AI turn failed on conversation ${conversationId} (failure ${failures})`);
      if (failures >= 2) {
        return this.escalateAfterAiFailure(conversationId, memberMessage, history, 'PROVIDER_ERROR');
      }
      return {
        conversation: conversationView(await this.conversations.findById(conversationId)),
        memberMessage: messageView(memberMessage),
        aiMessage: null,
        systemMessage: null,
        quickReplies: quickRepliesFor(await this.conversations.findById(conversationId)),
      };
    }

    const aiMessage = await this.messages.create({
      conversationId,
      senderType: SupportSenderType.AI_CHATBOT,
      senderId: null,
      // Plan §5.5: redact secrets after guardrails inspected the raw text, before persist/send.
      content: this.summary.redact(reply.reply),
      replyToMessageId: memberMessage.id,
      aiMetadata: {
        ...reply.metadata,
        confidence: reply.confidence,
        resolution: reply.resolution,
      } as unknown as Prisma.InputJsonValue,
    });

    await this.conversations.recordAiTurn(conversationId, {
      suggestedResolution: reply.resolution === 'RESOLVED_SUGGESTED',
    });

    if (reply.resolution === 'NEEDS_HUMAN' || reply.resolution === 'UNCERTAIN') {
      const reason = reply.escalationReason ?? SupportEscalationReason.STAFF_NEEDED;
      // "Gặp nhân viên" typed in the chat skips the model, so the model still writes the hand-off summary.
      const aiSummary =
        reason === SupportEscalationReason.MEMBER_REQUEST
          ? await this.handoffAi.summarize(
              history.some((m) => m.id === memberMessage.id) ? history : [...history, memberMessage],
              ESCALATION_REASON_LABEL[reason],
            )
          : null;
      const summary = this.handoffSummary(aiSummary ?? reply.handoffSummary, history, reason);
      const escalated = await this.escalation.escalate({
        conversationId,
        reason: reply.escalationReason ?? SupportEscalationReason.STAFF_NEEDED,
        note: summary,
        summary,
        actorId: null,
      });
      return {
        conversation: conversationView(escalated.conversation),
        memberMessage: messageView(memberMessage),
        aiMessage: messageView(aiMessage),
        systemMessage: escalated.systemMessage ? messageView(escalated.systemMessage) : null,
        quickReplies: reply.quickReplies,
      };
    }

    const current = await this.conversations.findById(conversationId);
    return {
      conversation: conversationView(current),
      memberMessage: messageView(memberMessage),
      aiMessage: messageView(aiMessage),
      systemMessage: null,
      quickReplies: reply.quickReplies.length ? reply.quickReplies : quickRepliesFor(current),
    };
  }

  private async escalateAfterAiFailure(
    conversationId: string,
    memberMessage: SupportMessage,
    history: SupportMessage[],
    cause: string,
  ): Promise<SupportSendResult> {
    await this.conversations.recordAiFailure(conversationId);
    const note = `Trợ lý AI không thể trả lời (${cause}).`;
    const summary = this.handoffSummary(undefined, history, SupportEscalationReason.AI_UNAVAILABLE, note);
    const escalated = await this.escalation.escalate({
      conversationId,
      reason: SupportEscalationReason.AI_UNAVAILABLE,
      note,
      summary,
      actorId: null,
    });

    return {
      conversation: conversationView(escalated.conversation),
      memberMessage: messageView(memberMessage),
      aiMessage: null,
      systemMessage: escalated.systemMessage ? messageView(escalated.systemMessage) : null,
      quickReplies: [],
    };
  }

  /** The Staff-facing summary of a hand-off; also used when the member asks for a human. */
  handoffSummary(
    provided: string | undefined,
    history: SupportMessage[],
    reason: SupportEscalationReason,
    note?: string,
  ): string {
    const summary =
      provided ??
      this.summary.fromTranscript({
        messages: history,
        reason: note ?? escalationText(reason),
        verifiedFacts: {},
        steps: [],
      });
    return this.summary.redact(summary);
  }

  /** Live facts in the prompt (plan §4.6); never a value the AI can write back. */
  private async platformFacts(): Promise<Record<string, unknown>> {
    const settings = await this.settings.get();
    return {
      coinRateVnd: settings.coinRateVnd,
      bonusCoinExpiryDays: settings.bonusCoinExpiryDays,
      coinTopUpMinVnd: settings.coinTopUpMinVnd,
      coinTopUpMaxVnd: settings.coinTopUpMaxVnd,
      subscriptionCancelWindowHours: settings.subscriptionCancelWindowHours,
      freeStarterEpisodeCount: settings.freeStarterEpisodeCount,
      refundOnRemoval: settings.refundOnRemoval,
    };
  }
}

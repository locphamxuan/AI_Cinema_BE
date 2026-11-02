import { Inject, Injectable } from '@nestjs/common';
import { SupportEscalationReason, SupportSenderType } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { SUPPORT_QUICK_REPLY, type SupportQuickReply } from '../shared/support-status';
import type { RetrievedKnowledge } from '../shared/support-view';
import { SupportAiUnavailableError } from './ai-errors';
import { IntentRouterService } from './intent-router';

export type SupportAgentResolution = 'ANSWERED' | 'RESOLVED_SUGGESTED' | 'NEEDS_HUMAN' | 'UNCERTAIN';

export interface SupportAgentTurn {
  conversationId: string;
  memberId: string;
  message: string;
  history: Array<{ senderType: SupportSenderType; content: string }>;
  platformFacts: Record<string, unknown>;
  retrieved: RetrievedKnowledge[];
}

export interface SupportAgentReply {
  reply: string;
  resolution: SupportAgentResolution;
  confidence: number;
  escalationReason?: SupportEscalationReason;
  handoffSummary?: string;
  quickReplies: SupportQuickReply[];
  metadata: {
    model: string;
    latencyMs: number;
    sources: Array<{ articleId: string; title: string; heading: string }>;
    toolCalls: Array<{ name: string; result: unknown }>;
    promptTokens?: number;
    completionTokens?: number;
  };
}

/**
 * Phase 1 keeps the orchestration seam only: the tool loop, structured output and provider
 * calls land in Phase 4. `mock` returns deterministic answers for e2e; `live` refuses until a
 * client is wired, so the chat service escalates instead of inventing an answer.
 */
@Injectable()
export class SupportAgentService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly intent: IntentRouterService,
  ) {}

  get enabled(): boolean {
    return this.config.support.aiMode !== 'disabled';
  }

  reply(turn: SupportAgentTurn): Promise<SupportAgentReply> {
    if (this.config.support.aiMode === 'disabled') {
      throw new SupportAiUnavailableError('DISABLED', 'AI_MODE=disabled: support chat runs as a human inbox');
    }
    if (this.config.support.aiMode === 'live' && !this.config.support.aiChatApiKey) {
      throw new SupportAiUnavailableError('NOT_CONFIGURED', 'AI_CHAT_API_KEY is missing');
    }

    const startedAt = Date.now();
    const intent = this.intent.route(turn.message);

    if (this.config.support.aiMode === 'mock') {
      return Promise.resolve(this.mockReply(turn, intent, startedAt));
    }

    // Phase 4 wires OpenAiCompatibleLlmClient + tools + structured output here.
    throw new SupportAiUnavailableError(
      'NOT_CONFIGURED',
      'The LLM client is not wired yet (Phase 4); the case is handed to Staff',
    );
  }

  private mockReply(
    turn: SupportAgentTurn,
    intent: ReturnType<IntentRouterService['route']>,
    startedAt: number,
  ): SupportAgentReply {
    const sources = turn.retrieved.map(({ articleId, title, heading }) => ({ articleId, title, heading }));
    const metadata = {
      model: 'mock',
      latencyMs: Date.now() - startedAt,
      sources,
      toolCalls: [],
    };

    if (intent === 'escalate') {
      return {
        reply: 'Mình sẽ chuyển cuộc hội thoại này đến nhân viên hỗ trợ để bạn được trợ giúp trực tiếp.',
        resolution: 'NEEDS_HUMAN',
        confidence: 1,
        escalationReason: SupportEscalationReason.MEMBER_REQUEST,
        handoffSummary: 'Thành viên yêu cầu được nhân viên hỗ trợ.',
        quickReplies: [],
        metadata,
      };
    }
    if (intent === 'resolve') {
      return {
        reply: 'Rất vui vì đã giúp được bạn. Bạn có thể xác nhận để đóng yêu cầu hỗ trợ này.',
        resolution: 'RESOLVED_SUGGESTED',
        confidence: 0.9,
        quickReplies: [SUPPORT_QUICK_REPLY.CONFIRM_RESOLVED],
        metadata,
      };
    }
    if (intent === 'tool') {
      return {
        reply:
          'Đây là môi trường mock: câu trả lời dựa trên dữ liệu mẫu. Khi AI được bật, mình sẽ kiểm tra số dư Coin, gói và quyền xem từ hệ thống trước khi trả lời.',
        resolution: 'ANSWERED',
        confidence: 0.6,
        quickReplies: [SUPPORT_QUICK_REPLY.REQUEST_STAFF],
        metadata,
      };
    }
    return {
      reply:
        'Mình là Trợ lý AI của AI Cinema (mock). Bạn có thể hỏi về gói dịch vụ, Coin, thanh toán, quyền xem nội dung hoặc thiết bị.',
      resolution: 'ANSWERED',
      confidence: 0.7,
      quickReplies: [SUPPORT_QUICK_REPLY.CONFIRM_RESOLVED, SUPPORT_QUICK_REPLY.REQUEST_STAFF],
      metadata,
    };
  }
}

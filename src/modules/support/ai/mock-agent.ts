import { SupportEscalationReason } from '@prisma/client';
import { SUPPORT_QUICK_REPLY } from '../shared/support-status';
import type { IntentRouterService } from './intent-router';
import type { SupportAgentReply, SupportAgentTurn } from './support-agent.service';

/** Canned answers for AI_MODE=mock: no provider call, same reply shape as the live agent. */
export function mockReply(
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

import { SupportEscalationReason } from '@prisma/client';
import type { AgentOutput } from './agent-output';
import type { GuardrailsService } from './guardrails';
import type { PromptBuilderService } from './prompt-builder';
import type { SupportAgentReply, SupportAgentToolCall, SupportAgentTurn, TokenUsage } from './support-agent.service';

/** Plan §3.5: blocked or low-confidence text never reaches the member as a confident answer. */
export function applyGuardrails(
  output: AgentOutput,
  turn: SupportAgentTurn,
  guardrails: GuardrailsService,
  promptBuilder: PromptBuilderService,
): AgentOutput {
  const verdict = guardrails.check(output.reply, output.confidence);
  if (verdict.action === 'proceed') return output;

  if (verdict.action === 'block') {
    return {
      reply: 'Mình không thể xử lý yêu cầu này qua trợ lý AI. Mình sẽ chuyển bạn đến nhân viên hỗ trợ.',
      resolution: 'NEEDS_HUMAN',
      confidence: 0,
      escalationReason: SupportEscalationReason.STAFF_NEEDED,
      handoffSummary: promptBuilder.buildEscalationSummary({
        reason: turn.message,
        verifiedFacts: {},
        steps: [],
        currentResult: `Guardrail đã chặn câu trả lời của AI (${verdict.reason ?? 'unsafe output'}).`,
        suggestion: 'Nhân viên kiểm tra yêu cầu và phản hồi trực tiếp cho thành viên.',
      }),
      quickReplies: [],
    };
  }

  return {
    reply: 'Mình chưa chắc chắn về câu trả lời này. Mình sẽ chuyển bạn đến nhân viên hỗ trợ để kiểm tra chính xác.',
    resolution: 'NEEDS_HUMAN',
    confidence: output.confidence,
    escalationReason: output.escalationReason ?? SupportEscalationReason.INSUFFICIENT_INFO,
    handoffSummary:
      output.handoffSummary ??
      promptBuilder.buildEscalationSummary({
        reason: turn.message,
        verifiedFacts: {},
        steps: [],
        currentResult: `AI trả lời với confidence thấp (${output.confidence}).`,
        suggestion: 'Nhân viên xác minh thông tin trước khi trả lời.',
      }),
    quickReplies: [],
  };
}

/** What the assistant says when a question is outside AI Cinema (audit 2026-11-12). */
export const OUT_OF_SCOPE_REPLY =
  'Mình là Trợ lý AI của AI Cinema nên chỉ hỗ trợ các câu hỏi về tài khoản, gói thành viên, Coin, thanh toán, ' +
  'quyền xem phim, thiết bị và xem nhóm trên AI Cinema. Bạn cần hỗ trợ vấn đề nào trong số này?';

/**
 * Server-side scope gate (audit 2026-11-12): the system prompt asks the model to answer only from
 * the knowledge base and the tools, but nothing enforced it — with no article retrieved and no
 * tool called, a confident ANSWERED reply could only come from the model's own training data
 * (general knowledge, other platforms, made-up policies). Such a reply is replaced by the scope
 * message; escalations pass through untouched so Staff still sees them.
 */
export function applyScopeGate(
  output: AgentOutput,
  turn: Pick<SupportAgentTurn, 'retrieved'>,
  toolCalls: SupportAgentToolCall[],
): AgentOutput {
  if (output.resolution !== 'ANSWERED' && output.resolution !== 'RESOLVED_SUGGESTED') return output;
  const grounded =
    turn.retrieved.length > 0 || toolCalls.some((call) => (call.result as { ok?: boolean } | null)?.ok === true);
  if (grounded) return output;
  return { ...output, reply: OUT_OF_SCOPE_REPLY, resolution: 'ANSWERED', handoffSummary: undefined, quickReplies: [] };
}

export function fallbackReply(
  turn: SupportAgentTurn,
  startedAt: number,
  model: string,
  usage: TokenUsage,
  toolCalls: SupportAgentToolCall[],
  reason: SupportEscalationReason,
  handoffSummary: string,
): SupportAgentReply {
  return {
    reply: 'Mình chưa thể trả lời chắc chắn câu hỏi này. Mình sẽ chuyển bạn đến nhân viên hỗ trợ để kiểm tra.',
    resolution: 'NEEDS_HUMAN',
    confidence: 0,
    escalationReason: reason,
    handoffSummary,
    quickReplies: [],
    metadata: agentMetadata(turn, startedAt, model, usage, toolCalls),
  };
}

export function agentMetadata(
  turn: SupportAgentTurn,
  startedAt: number,
  model: string,
  usage: TokenUsage,
  toolCalls: SupportAgentToolCall[],
): SupportAgentReply['metadata'] {
  return {
    model,
    latencyMs: Date.now() - startedAt,
    sources: turn.retrieved.map(({ articleId, title, heading }) => ({ articleId, title, heading })),
    toolCalls,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  };
}

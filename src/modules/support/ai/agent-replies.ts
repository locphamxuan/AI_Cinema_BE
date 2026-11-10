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

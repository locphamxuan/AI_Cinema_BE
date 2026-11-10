import { Inject, Injectable, Optional } from '@nestjs/common';
import { SupportEscalationReason, SupportSenderType } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import {
  CHAT_CLIENT,
  type ChatClient,
  type ChatMessage,
  type ChatResult,
  type ChatToolCall,
} from 'src/infrastructure/ai/llm-client';
import { SUPPORT_QUICK_REPLY, type SupportQuickReply } from '../shared/support-status';
import type { RetrievedKnowledge } from '../shared/support-view';
import { SupportAiUnavailableError } from './ai-errors';
import { GuardrailsService } from './guardrails';
import { IntentRouterService } from './intent-router';
import { PromptBuilderService } from './prompt-builder';
import {
  FINAL_ANSWER_TOOL,
  FINAL_ANSWER_TOOL_NAME,
  SUPPORT_TOOL_DEFINITIONS,
  type SupportToolName,
} from './tools/tool-definitions';
import { SupportTools } from './tools/support-tools.service';

export type SupportAgentResolution = 'ANSWERED' | 'RESOLVED_SUGGESTED' | 'NEEDS_HUMAN' | 'UNCERTAIN';

export interface SupportAgentTurn {
  conversationId: string;
  memberId: string;
  message: string;
  history: Array<{ senderType: SupportSenderType; content: string }>;
  platformFacts: Record<string, unknown>;
  retrieved: RetrievedKnowledge[];
}

export interface SupportAgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
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
    toolCalls: SupportAgentToolCall[];
    promptTokens?: number;
    completionTokens?: number;
  };
}

interface AgentOutput {
  reply: string;
  resolution: SupportAgentResolution;
  escalationReason?: SupportEscalationReason;
  confidence: number;
  handoffSummary?: string;
  quickReplies: SupportQuickReply[];
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

const RESOLUTION_SET = new Set<string>(['ANSWERED', 'RESOLVED_SUGGESTED', 'NEEDS_HUMAN', 'UNCERTAIN']);
const ESCALATION_REASON_SET = new Set<string>(Object.values(SupportEscalationReason));
const QUICK_REPLY_SET = new Set<string>(Object.values(SUPPORT_QUICK_REPLY));
const SUPPORT_TOOL_NAMES = new Set<string>(SUPPORT_TOOL_DEFINITIONS.map((tool) => tool.name));

const FINAL_ANSWER_INSTRUCTION = [
  '[FINAL ANSWER]',
  `Khi đã đủ thông tin, gọi tool \`${FINAL_ANSWER_TOOL_NAME}\` để gửi câu trả lời cuối cùng.`,
  'Chỉ trả lời dựa trên TÀI LIỆU và DỮ LIỆU CÔNG CỤ. Không bịa số dư, giao dịch, gói hoặc quyền xem.',
  'Nếu thiếu dữ liệu hoặc không chắc chắn, dùng resolution NEEDS_HUMAN và nêu escalationReason phù hợp.',
  'Sau khi đã có kết quả công cụ, không gọi thêm tool dữ liệu nếu không cần thiết.',
].join('\n');

/**
 * Phase 4 orchestration (plan §5.3): live mode builds a grounded prompt, runs a bounded read-only
 * tool loop, then forces the `final_answer` tool so the server receives a validated object.
 * A malformed answer is retried once; after that the case is handed to Staff instead of guessing.
 */
@Injectable()
export class SupportAgentService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly intent: IntentRouterService,
    @Optional() @Inject(CHAT_CLIENT) private readonly chatClient: ChatClient | null,
    private readonly tools: SupportTools,
    private readonly promptBuilder: PromptBuilderService,
    private readonly guardrails: GuardrailsService,
  ) {}

  get enabled(): boolean {
    return this.config.support.aiMode !== 'disabled';
  }

  async reply(turn: SupportAgentTurn): Promise<SupportAgentReply> {
    if (this.config.support.aiMode === 'disabled') {
      throw new SupportAiUnavailableError('DISABLED', 'AI_MODE=disabled: support chat runs as a human inbox');
    }

    const startedAt = Date.now();
    const intent = this.intent.route(turn.message);

    if (this.config.support.aiMode === 'mock') {
      return this.mockReply(turn, intent, startedAt);
    }
    // Plan §5.4: a direct staff request never waits for the model.
    if (intent === 'escalate') {
      return this.directEscalationReply(turn, startedAt);
    }
    if (!this.chatClient) {
      throw new SupportAiUnavailableError('NOT_CONFIGURED', 'AI chat provider is not configured');
    }
    return this.liveReply(turn, startedAt);
  }

  private directEscalationReply(turn: SupportAgentTurn, startedAt: number): SupportAgentReply {
    return {
      reply: 'Mình sẽ chuyển cuộc hội thoại này đến nhân viên hỗ trợ để bạn được trợ giúp trực tiếp.',
      resolution: 'NEEDS_HUMAN',
      confidence: 1,
      escalationReason: SupportEscalationReason.MEMBER_REQUEST,
      handoffSummary: 'Thành viên yêu cầu được nhân viên hỗ trợ.',
      quickReplies: [],
      metadata: {
        model: this.chatClient?.model ?? this.config.support.aiChatModel,
        latencyMs: Date.now() - startedAt,
        sources: turn.retrieved.map(({ articleId, title, heading }) => ({ articleId, title, heading })),
        toolCalls: [],
        promptTokens: 0,
        completionTokens: 0,
      },
    };
  }

  private async liveReply(turn: SupportAgentTurn, startedAt: number): Promise<SupportAgentReply> {
    const client = this.chatClient;
    if (!client) throw new SupportAiUnavailableError('NOT_CONFIGURED', 'AI chat provider is not configured');

    const messages = this.initialMessages(turn);
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
    const toolCalls: SupportAgentToolCall[] = [];
    let model = this.config.support.aiChatModel;

    let result = await this.supportChat(client, messages);
    this.addUsage(usage, result);
    model = result.model || model;

    let rounds = 0;
    while (result.toolCalls.length && rounds < this.config.support.aiMaxToolRounds) {
      rounds++;
      messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        const execution = await this.executeTool(turn.memberId, call);
        toolCalls.push(execution.metadata);
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(execution.payload) });
      }
      result = await this.supportChat(client, messages);
      this.addUsage(usage, result);
      model = result.model || model;
    }

    // A draft without tool calls is useful context for the forced final answer.
    if (!result.toolCalls.length && result.content.trim()) {
      messages.push({ role: 'assistant', content: result.content });
    }

    const finalized = await this.finalize(client, messages, usage);
    if (finalized) {
      model = finalized.model || model;
      return this.toReply(finalized.output, turn, startedAt, model, usage, toolCalls);
    }

    return this.fallbackReply(
      turn,
      startedAt,
      model,
      usage,
      toolCalls,
      SupportEscalationReason.INSUFFICIENT_INFO,
      this.invalidOutputSummary(turn, toolCalls),
    );
  }

  private invalidOutputSummary(turn: SupportAgentTurn, toolCalls: SupportAgentToolCall[]): string {
    return this.promptBuilder.buildEscalationSummary({
      reason: turn.message,
      verifiedFacts: { toolsCalled: toolCalls.map((call) => call.name) },
      steps: toolCalls.map((call) => `Đã gọi ${call.name}`),
      currentResult: 'AI không tạo được câu trả lời có cấu trúc hợp lệ sau 2 lần thử.',
      suggestion: 'Kiểm tra hội thoại và xác minh dữ liệu tài khoản trước khi trả lời.',
    });
  }

  private initialMessages(turn: SupportAgentTurn): ChatMessage[] {
    const last = turn.history[turn.history.length - 1];
    const history =
      last && last.senderType === SupportSenderType.MEMBER && last.content === turn.message
        ? turn.history.slice(0, -1)
        : turn.history;
    const systemPrompt = this.promptBuilder.build({
      platformFacts: turn.platformFacts,
      retrieved: turn.retrieved,
      history,
    });

    return [
      { role: 'system', content: `${systemPrompt}\n\n${FINAL_ANSWER_INSTRUCTION}` },
      { role: 'user', content: turn.message },
    ];
  }

  /** Data tools are only read-only and scoped by the signed-in member id, never by model args. */
  private async executeTool(
    memberId: string,
    call: ChatToolCall,
  ): Promise<{ metadata: SupportAgentToolCall; payload: unknown }> {
    const args = parseToolArguments(call.arguments);
    const payload = isSupportToolName(call.name)
      ? await this.tools.execute(call.name, memberId, args)
      : { ok: false as const, error: 'UNAVAILABLE' as const };
    return { metadata: { name: call.name, arguments: args, result: payload }, payload };
  }

  private supportChat(client: ChatClient, messages: ChatMessage[]): Promise<ChatResult> {
    return client.chat({
      messages,
      tools: SUPPORT_TOOL_DEFINITIONS,
      toolChoice: 'auto',
      temperature: this.config.support.aiTemperature,
      maxOutputTokens: this.config.support.aiMaxOutputTokens,
      timeoutMs: this.config.support.aiTimeoutMs,
    });
  }

  private finalChat(client: ChatClient, messages: ChatMessage[]): Promise<ChatResult> {
    return client.chat({
      messages,
      tools: [FINAL_ANSWER_TOOL],
      toolChoice: { type: 'function', function: { name: FINAL_ANSWER_TOOL_NAME } },
      // Deterministic structured output matters more than tone variety on the final turn.
      temperature: 0,
      maxOutputTokens: this.config.support.aiMaxOutputTokens,
      timeoutMs: this.config.support.aiTimeoutMs,
    });
  }

  /** Two attempts: one normal, one corrective prompt. A provider error still propagates. */
  private async finalize(
    client: ChatClient,
    messages: ChatMessage[],
    usage: TokenUsage,
  ): Promise<{ output: AgentOutput; model: string } | null> {
    let model = this.config.support.aiChatModel;

    for (let attempt = 0; attempt < 2; attempt++) {
      const instruction =
        attempt === 0
          ? `Hãy gửi câu trả lời cuối cùng cho thành viên bằng cách gọi tool ${FINAL_ANSWER_TOOL_NAME}.`
          : 'Câu trả lời trước không đúng JSON schema. Hãy gọi lại tool final_answer với đầy đủ reply, resolution, confidence và quickReplies.';
      const result = await this.finalChat(client, [...messages, { role: 'user', content: instruction }]);
      this.addUsage(usage, result);
      model = result.model || model;

      const raw = result.toolCalls.find((call) => call.name === FINAL_ANSWER_TOOL_NAME)?.arguments ?? result.content;
      const output = parseAgentOutput(raw);
      if (output) return { output, model };
    }
    return null;
  }

  private toReply(
    output: AgentOutput,
    turn: SupportAgentTurn,
    startedAt: number,
    model: string,
    usage: TokenUsage,
    toolCalls: SupportAgentToolCall[],
  ): SupportAgentReply {
    return {
      ...this.applyGuardrails(output, turn),
      metadata: this.metadata(turn, startedAt, model, usage, toolCalls),
    };
  }

  /** Plan §3.5: blocked or low-confidence text never reaches the member as a confident answer. */
  private applyGuardrails(output: AgentOutput, turn: SupportAgentTurn): AgentOutput {
    const verdict = this.guardrails.check(output.reply, output.confidence);
    if (verdict.action === 'proceed') return output;

    if (verdict.action === 'block') {
      return {
        reply: 'Mình không thể xử lý yêu cầu này qua trợ lý AI. Mình sẽ chuyển bạn đến nhân viên hỗ trợ.',
        resolution: 'NEEDS_HUMAN',
        confidence: 0,
        escalationReason: SupportEscalationReason.STAFF_NEEDED,
        handoffSummary: this.promptBuilder.buildEscalationSummary({
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
        this.promptBuilder.buildEscalationSummary({
          reason: turn.message,
          verifiedFacts: {},
          steps: [],
          currentResult: `AI trả lời với confidence thấp (${output.confidence}).`,
          suggestion: 'Nhân viên xác minh thông tin trước khi trả lời.',
        }),
      quickReplies: [],
    };
  }

  private fallbackReply(
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
      metadata: this.metadata(turn, startedAt, model, usage, toolCalls),
    };
  }

  private metadata(
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

  private addUsage(usage: TokenUsage, result: ChatResult): void {
    usage.promptTokens += result.promptTokens ?? 0;
    usage.completionTokens += result.completionTokens ?? 0;
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

function isSupportToolName(name: string): name is SupportToolName {
  return SUPPORT_TOOL_NAMES.has(name);
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const value = parseJson(raw);
  return isRecord(value) ? value : {};
}

function parseAgentOutput(raw: string): AgentOutput | null {
  const value = parseJson(raw);
  if (!isRecord(value)) return null;

  const reply = typeof value.reply === 'string' ? value.reply.trim() : '';
  if (!reply) return null;

  const resolution =
    typeof value.resolution === 'string' && RESOLUTION_SET.has(value.resolution)
      ? (value.resolution as SupportAgentResolution)
      : null;
  if (!resolution) return null;

  const confidence = parseConfidence(value.confidence);
  if (confidence === null) return null;

  const escalationReason =
    typeof value.escalationReason === 'string' && ESCALATION_REASON_SET.has(value.escalationReason)
      ? (value.escalationReason as SupportEscalationReason)
      : undefined;
  const handoffSummary =
    typeof value.handoffSummary === 'string' && value.handoffSummary.trim() ? value.handoffSummary.trim() : undefined;
  const quickReplies = Array.isArray(value.quickReplies)
    ? value.quickReplies.filter(
        (item): item is SupportQuickReply => typeof item === 'string' && QUICK_REPLY_SET.has(item),
      )
    : [];

  return { reply, resolution, escalationReason, confidence, handoffSummary, quickReplies };
}

function parseConfidence(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

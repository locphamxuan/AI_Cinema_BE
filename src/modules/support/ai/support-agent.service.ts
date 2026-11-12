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
import type { SupportQuickReply } from '../shared/support-status';
import type { RetrievedKnowledge } from '../shared/support-view';
import { SupportAiUnavailableError } from './ai-errors';
import { GuardrailsService } from './guardrails';
import { IntentRouterService } from './intent-router';
import { PromptBuilderService } from './prompt-builder';
import { FINAL_ANSWER_TOOL, FINAL_ANSWER_TOOL_NAME, SUPPORT_TOOL_DEFINITIONS } from './tools/tool-definitions';
import { SupportTools } from './tools/support-tools.service';
import {
  parseAgentOutput,
  parseToolArguments,
  isSupportToolName,
  type AgentOutput,
  type SupportAgentResolution,
} from './agent-output';
import { agentMetadata, applyGuardrails, applyScopeGate, fallbackReply } from './agent-replies';
import { mockReply } from './mock-agent';

export type { SupportAgentResolution };

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

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

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
      return mockReply(turn, intent, startedAt);
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

    return fallbackReply(
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
      ...applyScopeGate(applyGuardrails(output, turn, this.guardrails, this.promptBuilder), turn, toolCalls),
      metadata: agentMetadata(turn, startedAt, model, usage, toolCalls),
    };
  }

  private addUsage(usage: TokenUsage, result: ChatResult): void {
    usage.promptTokens += result.promptTokens ?? 0;
    usage.completionTokens += result.completionTokens ?? 0;
  }
}

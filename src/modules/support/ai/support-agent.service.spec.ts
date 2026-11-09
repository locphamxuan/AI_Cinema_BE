import { SupportEscalationReason, SupportSenderType } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { ChatClient, ChatRequest, ChatResult } from 'src/infrastructure/ai/llm-client';
import { GuardrailsService } from './guardrails';
import { IntentRouterService } from './intent-router';
import { PromptBuilderService } from './prompt-builder';
import { SupportAgentService, type SupportAgentTurn } from './support-agent.service';
import { FINAL_ANSWER_TOOL, FINAL_ANSWER_TOOL_NAME, SUPPORT_TOOL_DEFINITIONS } from './tools/tool-definitions';
import type { SupportTools } from './tools/support-tools.service';

function config(overrides: Partial<AppConfig['support']> = {}): AppConfig {
  return {
    support: {
      aiMode: 'live',
      aiChatModel: 'test-model',
      aiTemperature: 0.2,
      aiMaxOutputTokens: 256,
      aiTimeoutMs: 1000,
      aiMaxToolRounds: 2,
      aiHistoryMessages: 20,
      ragTopK: 6,
      ragMinScore: 0.35,
      ...overrides,
    },
  } as unknown as AppConfig;
}

class FakeChatClient implements ChatClient {
  readonly model = 'fake-model';
  readonly calls: ChatRequest[] = [];

  constructor(private readonly responses: Array<ChatResult | Error>) {}

  chat(request: ChatRequest): Promise<ChatResult> {
    this.calls.push(request);
    const next = this.responses.shift();
    if (!next) return Promise.reject(new Error('unexpected chat call'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }
}

function chatResult(
  content: string,
  toolCalls: ChatResult['toolCalls'] = [],
  tokens: Pick<ChatResult, 'promptTokens' | 'completionTokens'> = { promptTokens: 1, completionTokens: 1 },
): ChatResult {
  return { content, toolCalls, model: 'test-model', ...tokens };
}

function toolCall(name: string, args: Record<string, unknown> = {}): ChatResult {
  return chatResult('', [{ id: `call_${name}`, name, arguments: JSON.stringify(args) }]);
}

function finalAnswer(output: unknown): ChatResult {
  return chatResult('', [{ id: 'call_final', name: FINAL_ANSWER_TOOL_NAME, arguments: JSON.stringify(output) }]);
}

const turn: SupportAgentTurn = {
  conversationId: 'conversation-1',
  memberId: 'member-1',
  message: 'Số dư Coin của tôi là bao nhiêu?',
  history: [
    { senderType: SupportSenderType.MEMBER, content: 'Xin chào' },
    { senderType: SupportSenderType.AI_CHATBOT, content: 'Chào bạn' },
    { senderType: SupportSenderType.MEMBER, content: 'Số dư Coin của tôi là bao nhiêu?' },
  ],
  platformFacts: { coinRateVnd: 1000 },
  retrieved: [
    {
      articleId: 'article-1',
      title: 'Coin',
      chunkIndex: 0,
      heading: 'Số dư',
      content: 'Số dư Coin xem trong ví.',
      score: 0.9,
    },
  ],
};

function buildAgent(
  client: ChatClient | null,
  options: { overrides?: Partial<AppConfig['support']>; execute?: jest.Mock } = {},
) {
  const execute = options.execute ?? jest.fn().mockResolvedValue({ ok: true, data: { mainBalance: 100 } });
  const tools = { execute } as unknown as SupportTools;
  const agent = new SupportAgentService(
    config(options.overrides),
    new IntentRouterService(),
    client,
    tools,
    new PromptBuilderService(),
    new GuardrailsService(),
  );
  return { agent, execute };
}

describe('SupportAgentService (live)', () => {
  it('runs the read-only tool loop and forces a structured final answer', async () => {
    const client = new FakeChatClient([
      toolCall('get_member_wallet'),
      chatResult('', [], { promptTokens: 5, completionTokens: 2 }),
      finalAnswer({
        reply: 'Số dư Coin chính của bạn là 100.',
        resolution: 'ANSWERED',
        confidence: 0.9,
        quickReplies: ['REQUEST_STAFF'],
      }),
    ]);
    const { agent, execute } = buildAgent(client);

    const reply = await agent.reply(turn);

    expect(execute).toHaveBeenCalledWith('get_member_wallet', 'member-1', {});
    expect(client.calls[0].tools).toEqual(SUPPORT_TOOL_DEFINITIONS);
    expect(client.calls[0].toolChoice).toBe('auto');
    expect(client.calls[0].messages[0].role).toBe('system');
    expect(client.calls[0].messages[0].content).toContain('[RETRIEVED KNOWLEDGE]');
    expect(client.calls[0].messages[0].content).toContain('article-1');
    expect(client.calls[0].messages[1]).toEqual({ role: 'user', content: turn.message });
    expect(client.calls[1].messages.at(-2)).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'call_get_member_wallet', name: 'get_member_wallet', arguments: '{}' }],
    });
    expect(client.calls[1].messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'call_get_member_wallet',
    });
    expect(client.calls[2].tools).toEqual([FINAL_ANSWER_TOOL]);
    expect(client.calls[2].toolChoice).toEqual({ type: 'function', function: { name: FINAL_ANSWER_TOOL_NAME } });
    expect(reply).toMatchObject({
      reply: 'Số dư Coin chính của bạn là 100.',
      resolution: 'ANSWERED',
      confidence: 0.9,
      quickReplies: ['REQUEST_STAFF'],
      metadata: {
        model: 'test-model',
        sources: [{ articleId: 'article-1', title: 'Coin', heading: 'Số dư' }],
        toolCalls: [
          {
            name: 'get_member_wallet',
            arguments: {},
            result: { ok: true, data: { mainBalance: 100 } },
          },
        ],
        promptTokens: 7,
        completionTokens: 4,
      },
    });
    expect(reply.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('retries invalid structured output once, then escalates', async () => {
    const client = new FakeChatClient([
      chatResult('draft', [], { promptTokens: 2, completionTokens: 1 }),
      finalAnswer({ reply: '' }),
      chatResult('not json', [], { promptTokens: 3, completionTokens: 2 }),
    ]);
    const { agent } = buildAgent(client);

    const reply = await agent.reply(turn);

    expect(client.calls).toHaveLength(3);
    expect(reply.resolution).toBe('NEEDS_HUMAN');
    expect(reply.escalationReason).toBe(SupportEscalationReason.INSUFFICIENT_INFO);
    expect(reply.confidence).toBe(0);
    expect(reply.quickReplies).toEqual([]);
    expect(reply.reply).toContain('chuyển bạn đến nhân viên');
    expect(reply.metadata.promptTokens).toBe(6);
    expect(reply.metadata.completionTokens).toBe(4);
  });

  it('stops the tool loop at AI_MAX_TOOL_ROUNDS and still finalizes', async () => {
    const client = new FakeChatClient([
      toolCall('get_member_wallet'),
      toolCall('get_member_wallet'),
      toolCall('get_member_wallet'),
      finalAnswer({ reply: 'Đã kiểm tra xong.', resolution: 'ANSWERED', confidence: 0.8, quickReplies: [] }),
    ]);
    const execute = jest.fn().mockResolvedValue({ ok: true, data: { mainBalance: 100 } });
    const { agent } = buildAgent(client, { execute, overrides: { aiMaxToolRounds: 2 } });

    const reply = await agent.reply(turn);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(client.calls).toHaveLength(4);
    expect(reply.metadata.toolCalls).toHaveLength(2);
    expect(reply.reply).toBe('Đã kiểm tra xong.');
  });

  it('blocks a reply that asks for OTP and hands the case to Staff', async () => {
    const client = new FakeChatClient([
      chatResult('draft'),
      finalAnswer({
        reply: 'Vui lòng cung cấp OTP của bạn.',
        resolution: 'ANSWERED',
        confidence: 0.9,
        quickReplies: ['CONFIRM_RESOLVED'],
      }),
    ]);
    const { agent } = buildAgent(client);

    const reply = await agent.reply(turn);

    expect(reply.resolution).toBe('NEEDS_HUMAN');
    expect(reply.escalationReason).toBe(SupportEscalationReason.STAFF_NEEDED);
    expect(reply.confidence).toBe(0);
    expect(reply.quickReplies).toEqual([]);
    expect(reply.reply).not.toContain('OTP');
    expect(reply.handoffSummary).toContain('Guardrail');
  });

  it('escalates a low-confidence answer instead of presenting it as settled', async () => {
    const client = new FakeChatClient([
      chatResult('draft'),
      finalAnswer({ reply: 'Có lẽ là vậy.', resolution: 'ANSWERED', confidence: 0.1, quickReplies: [] }),
    ]);
    const { agent } = buildAgent(client);

    const reply = await agent.reply(turn);

    expect(reply.resolution).toBe('NEEDS_HUMAN');
    expect(reply.escalationReason).toBe(SupportEscalationReason.INSUFFICIENT_INFO);
    expect(reply.reply).toContain('chưa chắc chắn');
  });

  it('reports NOT_CONFIGURED when no chat client is registered', async () => {
    const { agent } = buildAgent(null);

    await expect(agent.reply(turn)).rejects.toMatchObject({
      name: 'SupportAiUnavailableError',
      cause: 'NOT_CONFIGURED',
    });
  });

  it('escalates a direct staff request without calling the model', async () => {
    const client = new FakeChatClient([]);
    const { agent } = buildAgent(client);
    const message = 'Tôi muốn gặp nhân viên hỗ trợ';

    const reply = await agent.reply({
      ...turn,
      message,
      history: [{ senderType: SupportSenderType.MEMBER, content: message }],
    });

    expect(client.calls).toHaveLength(0);
    expect(reply.resolution).toBe('NEEDS_HUMAN');
    expect(reply.escalationReason).toBe(SupportEscalationReason.MEMBER_REQUEST);
  });

  it('keeps mock mode offline', async () => {
    const client = new FakeChatClient([]);
    const { agent } = buildAgent(client, { overrides: { aiMode: 'mock' } });

    const reply = await agent.reply(turn);

    expect(reply.metadata.model).toBe('mock');
    expect(client.calls).toHaveLength(0);
  });
});

import type { AgentOutput } from './agent-output';
import { applyScopeGate, OUT_OF_SCOPE_REPLY } from './agent-replies';
import { GuardrailsService } from './guardrails';
import type { SupportAgentToolCall } from './support-agent.service';

const ARTICLE = { articleId: 'a1', title: 'Coin', chunkIndex: 0, heading: 'Số dư', content: '...', score: 0.9 };

const answer = (overrides: Partial<AgentOutput> = {}): AgentOutput => ({
  reply: 'Netflix có gói Basic giá 180.000đ.',
  resolution: 'ANSWERED',
  confidence: 0.95,
  quickReplies: [],
  ...overrides,
});

const call = (ok: boolean): SupportAgentToolCall => ({
  name: 'get_member_wallet',
  arguments: {},
  result: ok ? { ok: true, data: { mainBalance: 100 } } : { ok: false, error: 'NOT_FOUND' },
});

describe('applyScopeGate (audit 2026-11-12)', () => {
  it('replaces an answer with neither an article nor tool data by the scope message', () => {
    const gated = applyScopeGate(answer(), { retrieved: [] }, []);
    expect(gated.reply).toBe(OUT_OF_SCOPE_REPLY);
    expect(gated.resolution).toBe('ANSWERED');
  });

  it('treats a failed tool call as no grounding', () => {
    expect(applyScopeGate(answer(), { retrieved: [] }, [call(false)]).reply).toBe(OUT_OF_SCOPE_REPLY);
  });

  it('keeps an answer grounded by a retrieved article or by tool data', () => {
    expect(applyScopeGate(answer({ reply: 'A' }), { retrieved: [ARTICLE] }, []).reply).toBe('A');
    expect(applyScopeGate(answer({ reply: 'B' }), { retrieved: [] }, [call(true)]).reply).toBe('B');
  });

  it('never turns an escalation into the scope message', () => {
    const escalation = answer({ resolution: 'NEEDS_HUMAN', reply: 'Chuyển nhân viên.' });
    expect(applyScopeGate(escalation, { retrieved: [] }, [])).toBe(escalation);
  });
});

describe('GuardrailsService promises (audit 2026-11-12)', () => {
  const guardrails = new GuardrailsService();

  it.each([
    'Khi một tập bị gỡ vĩnh viễn, hệ thống tự hoàn Coin cho người đã mở khóa tập đó.',
    'Theo quy định, Coin đã dùng không được hoàn trừ trường hợp tập bị gỡ.',
    'Bạn có thể đổi gói trong mục Gói dịch vụ.',
  ])('lets a policy explanation through: %s', (reply) => {
    expect(guardrails.check(reply, 0.9).action).toBe('proceed');
  });

  it.each([
    'Mình sẽ hoàn tiền toàn bộ cho bạn ngay.',
    'Mình sẽ cộng 50 Coin cho bạn.',
    'Chúng tôi đã hoàn Coin vào ví.',
    'Hoàn lại 20 Coin cho bạn nhé.',
    'Mình đổi gói miễn phí cho bạn.',
    'Tài khoản của bạn được xem miễn phí vĩnh viễn.',
  ])('blocks a promise in the AI voice: %s', (reply) => {
    expect(guardrails.check(reply, 0.9).action).toBe('block');
  });
});

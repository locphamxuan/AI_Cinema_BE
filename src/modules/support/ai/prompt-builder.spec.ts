import { CURRENT_RULES, PromptBuilderService } from './prompt-builder';

describe('PromptBuilderService', () => {
  const builder = new PromptBuilderService();

  it('puts the current business rules in the system prompt', () => {
    const prompt = builder.buildSystemPrompt();
    for (const rule of CURRENT_RULES) expect(prompt).toContain(rule);
    expect(prompt).toContain('không bao giờ hết hạn');
    expect(prompt).toContain('không nhận MoMo');
  });

  it('tells the model to trust the rules over an old article and to say when it is not sure', () => {
    const prompt = builder.buildSystemPrompt();
    expect(prompt).toContain('tài liệu đó đã cũ');
    expect(prompt).toContain('chưa chắc chắn');
    expect(prompt).not.toMatch(/hạn Coin thưởng/);
  });

  it('wraps retrieved chunks as data after the rules', () => {
    const prompt = builder.build({
      platformFacts: { coinRateVnd: 1000 },
      retrieved: [
        { articleId: 'a1', chunkIndex: 0, title: 'Coin "chính"', heading: 'Ví', content: 'Nội dung', score: 0.9 },
      ] as never,
      history: [],
    });
    expect(prompt.indexOf('QUY TẮC HIỆN HÀNH')).toBeLessThan(prompt.indexOf('<knowledge>'));
    expect(prompt).toContain('title="Coin &quot;chính&quot;"');
    expect(prompt).toContain('(chưa có tin nhắn trước đó)');
  });
});

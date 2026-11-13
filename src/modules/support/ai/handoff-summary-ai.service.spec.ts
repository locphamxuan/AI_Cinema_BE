import type { SupportMessage } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { ChatClient } from 'src/infrastructure/ai/llm-client';
import { HandoffSummaryAiService } from './handoff-summary-ai.service';
import { PromptBuilderService } from './prompt-builder';
import { SummaryService } from './summary.service';

const config = (aiMode: string) => ({ support: { aiMode, aiTimeoutMs: 5000 } }) as unknown as AppConfig;
const message = (senderType: string, content: string, isInternal = false) =>
  ({ id: content, senderType, content, isInternal }) as unknown as SupportMessage;
const HISTORY = [
  message('MEMBER', 'Tôi đã trả 20 Coin nhưng tập 3 không phát được'),
  message('AI_CHATBOT', 'Mình đã kiểm tra: tập 3 đã được mở khóa.'),
  message('SUPPORT_AGENT', 'ghi chú nội bộ', true),
];

function setup(aiMode = 'live', content = '- Tập 3 đã mở khóa nhưng không phát.') {
  const chat = jest.fn().mockResolvedValue({ content, toolCalls: [], model: 'm' });
  const client = { model: 'm', chat } as ChatClient;
  const service = new HandoffSummaryAiService(config(aiMode), new SummaryService(new PromptBuilderService()), client);
  return { service, chat };
}

describe('HandoffSummaryAiService (audit 2026-11-12)', () => {
  it('asks the model to summarize the visible transcript for Staff', async () => {
    const { service, chat } = setup();
    await expect(service.summarize(HISTORY, 'Thành viên yêu cầu')).resolves.toBe(
      '- Tập 3 đã mở khóa nhưng không phát.',
    );
    const [request] = chat.mock.calls[0] as [{ messages: { content: string }[] }];
    expect(request.messages[1].content).toContain('Thành viên: Tôi đã trả 20 Coin');
    expect(request.messages[1].content).toContain('Trợ lý AI: Mình đã kiểm tra');
    expect(request.messages[1].content).not.toContain('ghi chú nội bộ');
  });

  it('falls back (null) when the model is off, fails or answers nothing', async () => {
    await expect(setup('mock').service.summarize(HISTORY, 'x')).resolves.toBeNull();
    await expect(setup('live', '  ').service.summarize(HISTORY, 'x')).resolves.toBeNull();
    const { service, chat } = setup();
    chat.mockRejectedValue(new Error('timeout'));
    await expect(service.summarize(HISTORY, 'x')).resolves.toBeNull();
    await expect(service.summarize([], 'x')).resolves.toBeNull();
  });
});

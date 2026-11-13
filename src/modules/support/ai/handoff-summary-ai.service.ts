import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { SupportMessage } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { CHAT_CLIENT, type ChatClient } from 'src/infrastructure/ai/llm-client';
import { SummaryService } from './summary.service';

const SPEAKER: Record<string, string> = {
  MEMBER: 'Thành viên',
  AI_CHATBOT: 'Trợ lý AI',
  SUPPORT_AGENT: 'Nhân viên',
  SYSTEM: 'Hệ thống',
};

const INSTRUCTION = [
  'Bạn tóm tắt một ca hỗ trợ của nền tảng AI Cinema cho nhân viên sắp tiếp nhận.',
  'Viết tiếng Việt, tối đa 5 gạch đầu dòng: vấn đề của thành viên; những gì trợ lý AI đã trả lời hoặc đã kiểm tra;',
  'thông tin đã xác minh (chỉ khi có trong hội thoại); lý do chuyển nhân viên; việc nhân viên nên làm trước.',
  'Chỉ dùng nội dung trong hội thoại, không suy đoán, không hứa hẹn, không chép OTP, mật khẩu hay số thẻ.',
].join(' ');

/**
 * Audit 2026-11-12: when the member asks for a human, the model writes the hand-off summary Staff reads first,
 * so Staff never asks the member to start over. Null when the model is off or fails; the caller then falls
 * back to the template summary.
 */
@Injectable()
export class HandoffSummaryAiService {
  private readonly logger = new Logger(HandoffSummaryAiService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly summary: SummaryService,
    @Optional() @Inject(CHAT_CLIENT) private readonly chatClient: ChatClient | null,
  ) {}

  async summarize(history: SupportMessage[], reason: string): Promise<string | null> {
    if (this.config.support.aiMode !== 'live' || !this.chatClient) return null;
    const transcript = history
      .filter((message) => !message.isInternal)
      .map((message) => `${SPEAKER[message.senderType] ?? message.senderType}: ${this.summary.redact(message.content)}`)
      .join('\n');
    if (!transcript) return null;
    try {
      const result = await this.chatClient.chat({
        messages: [
          { role: 'system', content: INSTRUCTION },
          { role: 'user', content: `Lý do chuyển: ${reason}\n\nHội thoại:\n${transcript}` },
        ],
        temperature: 0.2,
        maxOutputTokens: 400,
        timeoutMs: this.config.support.aiTimeoutMs,
      });
      const text = result.content.trim();
      return text ? this.summary.redact(text) : null;
    } catch (error) {
      this.logger.warn(`Hand-off summary fell back to the template: ${(error as Error).message}`);
      return null;
    }
  }
}

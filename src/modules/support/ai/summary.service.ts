import { Injectable } from '@nestjs/common';
import type { SupportMessage } from '@prisma/client';
import { PromptBuilderService } from './prompt-builder';

/**
 * Plan §5.5: the hand-off summary Staff reads first. When the LLM has not produced one, this
 * deterministic fallback still gives Staff the issue, what was checked and where it stopped.
 */
@Injectable()
export class SummaryService {
  constructor(private readonly promptBuilder: PromptBuilderService) {}

  fromTranscript(input: {
    messages: SupportMessage[];
    reason: string;
    verifiedFacts?: Record<string, unknown>;
    steps?: string[];
    suggestion?: string;
  }): string {
    const memberLines = input.messages
      .filter((message) => message.senderType === 'MEMBER' && !message.isInternal)
      .slice(-3)
      .map((message) => truncate(message.content, 300));
    const lastProblem = memberLines.length ? memberLines.join(' / ') : input.reason;

    return this.promptBuilder.buildEscalationSummary({
      reason: lastProblem,
      verifiedFacts: input.verifiedFacts ?? {},
      steps: input.steps ?? [],
      currentResult: input.reason,
      suggestion: input.suggestion,
    });
  }

  /** OTPs, card numbers and passwords never reach the summary that Staff or logs can read. */
  redact(text: string): string {
    return text
      .replace(/\b\d{6}\b/g, '******')
      .replace(/\b\d{9,19}\b/g, '****')
      .replace(/(mật\s*khẩu|password|otp)\s*[:=]\s*\S+/gi, '$1: ****');
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

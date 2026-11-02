import { Injectable } from '@nestjs/common';

export interface GuardrailVerdict {
  valid: boolean;
  reason?: string;
  action: 'proceed' | 'escalate' | 'block';
}

/** Output checks of plan §8.2: nothing sensitive or over-promising leaves the AI. */
@Injectable()
export class GuardrailsService {
  private readonly forbiddenPromises = [
    /hoàn\s*tiền/i,
    /hoàn\s*coin/i,
    /đổi\s*gói/i,
    /tặng\s*coin/i,
    /miễn\s*phí\s*vĩnh\s*viễn/i,
  ];

  private readonly sensitiveRequests = [
    /mật\s*khẩu/i,
    /password/i,
    /\botp\b/i,
    /mã\s*xác\s*thực/i,
    /số\s*thẻ/i,
    /cvv/i,
  ];

  check(reply: string, confidence: number): GuardrailVerdict {
    const text = reply.trim();
    if (!text) {
      return { valid: false, reason: 'empty reply', action: 'escalate' };
    }
    if (this.sensitiveRequests.some((pattern) => pattern.test(text))) {
      return { valid: false, reason: 'asks for a secret', action: 'block' };
    }
    if (this.forbiddenPromises.some((pattern) => pattern.test(text))) {
      return { valid: false, reason: 'promises an action the AI cannot take', action: 'block' };
    }
    if (confidence < 0.3) {
      return { valid: false, reason: 'low confidence', action: 'escalate' };
    }
    return { valid: true, action: 'proceed' };
  }
}

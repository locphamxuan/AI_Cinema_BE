import { Injectable } from '@nestjs/common';

export interface GuardrailVerdict {
  valid: boolean;
  reason?: string;
  action: 'proceed' | 'escalate' | 'block';
}

/**
 * Output checks of plan §8.2: nothing sensitive or over-promising leaves the AI.
 *
 * Audit 2026-11-12: the refund rule used to block any reply containing "hoàn Coin", so the AI
 * could not even explain BR-52 ("tập bị gỡ vĩnh viễn thì Coin được hoàn tự động") that the
 * knowledge base itself documents. Only a promise in the AI's own voice is blocked now.
 */
@Injectable()
export class GuardrailsService {
  /** "mình/chúng tôi/em sẽ|đã|có thể <action>", or the action addressed to the member ("… cho bạn"). */
  private readonly forbiddenPromises = [
    /(mình|chúng\s*tôi|em|tôi|ai\s*cinema)\s+(sẽ|đã|có\s*thể|xin)\s+(hoàn|tặng|cộng|đổi|bù)/i,
    /(hoàn|tặng|cộng|bù)\s+(lại\s+)?(tiền|coin|\d+\s*coin)[^.]{0,30}\s+cho\s+bạn/i,
    /đổi\s*gói\s+(miễn\s*phí\s+)?cho\s+bạn/i,
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

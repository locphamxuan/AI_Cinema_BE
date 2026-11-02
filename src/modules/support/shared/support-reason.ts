import { SupportEscalationReason } from '@prisma/client';

/** Why the AI handed the case to Staff (flow doc step 6). */
export const ESCALATION_REASON_LABEL: Record<SupportEscalationReason, string> = {
  AI_UNAVAILABLE: 'Trợ lý AI tạm thời không phản hồi',
  INSUFFICIENT_INFO: 'AI không đủ thông tin để trả lời chắc chắn',
  ACCOUNT_VERIFICATION: 'Cần xác minh thông tin tài khoản hoặc giao dịch',
  MEMBER_REQUEST: 'Thành viên yêu cầu được nhân viên hỗ trợ',
  STAFF_NEEDED: 'Vấn đề vượt quá phạm vi tự xử lý của AI',
};

/** Case priority Staff sees in the queue: a direct request or a stuck account issue jumps ahead. */
export const ESCALATION_PRIORITY: Record<SupportEscalationReason, 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'> = {
  AI_UNAVAILABLE: 'HIGH',
  INSUFFICIENT_INFO: 'NORMAL',
  ACCOUNT_VERIFICATION: 'HIGH',
  MEMBER_REQUEST: 'HIGH',
  STAFF_NEEDED: 'NORMAL',
};

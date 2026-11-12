import {
  SupportStatus,
  type SupportConversation,
  type SupportEscalationReason,
  type SupportMessage,
} from '@prisma/client';
import { SUPPORT_QUICK_REPLY, type SupportQuickReply } from './support-status';
import type { SupportConversationView } from './support-view';

export function conversationView(conversation: SupportConversation): SupportConversationView {
  return {
    id: conversation.id,
    status: conversation.status,
    priority: conversation.priority,
    escalationReason: conversation.escalationReason,
    aiSummary: conversation.aiSummary,
    lastMessageAt: conversation.lastMessageAt,
    lastMemberMessageAt: conversation.lastMemberMessageAt,
    lastStaffMessageAt: conversation.lastStaffMessageAt,
    escalatedAt: conversation.escalatedAt,
    claimedAt: conversation.claimedAt,
    resolvedAt: conversation.resolvedAt,
    closedAt: conversation.closedAt,
    closeReason: conversation.closeReason,
    aiResolutionSuggestedAt: conversation.aiResolutionSuggestedAt,
    satisfactionRating: conversation.satisfactionRating,
    satisfactionComment: conversation.satisfactionComment,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function messageView(message: SupportMessage) {
  return {
    id: message.id,
    senderType: message.senderType,
    content: message.content,
    isInternal: message.isInternal,
    clientMessageId: message.clientMessageId,
    replyToMessageId: message.replyToMessageId,
    aiMetadata: (message.aiMetadata as Record<string, unknown> | null) ?? null,
    createdAt: message.createdAt,
  };
}

export function quickRepliesFor(conversation: SupportConversation): SupportQuickReply[] {
  if (conversation.status !== SupportStatus.AI_HANDLING) return [];
  return [SUPPORT_QUICK_REPLY.CONFIRM_RESOLVED, SUPPORT_QUICK_REPLY.REQUEST_STAFF];
}

export function escalationText(reason: SupportEscalationReason): string {
  return {
    AI_UNAVAILABLE: 'Trợ lý AI tạm thời không phản hồi.',
    INSUFFICIENT_INFO: 'Không đủ thông tin để trả lời chắc chắn.',
    ACCOUNT_VERIFICATION: 'Cần xác minh thông tin tài khoản hoặc giao dịch.',
    MEMBER_REQUEST: 'Thành viên yêu cầu nhân viên hỗ trợ.',
    STAFF_NEEDED: 'Vấn đề vượt quá phạm vi tự xử lý của trợ lý AI.',
  }[reason];
}

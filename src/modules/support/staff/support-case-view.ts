import { Prisma } from '@prisma/client';
import type { SupportStaffCaseView } from '../shared/support-view';

export const CASE_RELATIONS = {
  member: { select: { id: true, fullName: true } },
  assignedAgent: { select: { id: true, fullName: true } },
} satisfies Prisma.SupportConversationInclude;

export type CaseRow = Prisma.SupportConversationGetPayload<{ include: typeof CASE_RELATIONS }>;

/** The Staff-facing shape of a case row; the member view (support-presenter) hides these fields. */
export function staffCaseView(row: CaseRow): SupportStaffCaseView {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    escalationReason: row.escalationReason,
    aiSummary: row.aiSummary,
    lastMessageAt: row.lastMessageAt,
    lastMemberMessageAt: row.lastMemberMessageAt,
    lastStaffMessageAt: row.lastStaffMessageAt,
    escalatedAt: row.escalatedAt,
    claimedAt: row.claimedAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    aiResolutionSuggestedAt: row.aiResolutionSuggestedAt,
    satisfactionRating: row.satisfactionRating,
    satisfactionComment: row.satisfactionComment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    memberId: row.memberId,
    memberFullName: row.member.fullName,
    assignedAgentId: row.assignedAgentId,
    assignedAgentName: row.assignedAgent?.fullName ?? null,
    escalationNote: row.escalationNote,
    aiTurns: row.aiTurns,
    aiFailureCount: row.aiFailureCount,
    firstStaffReplyAt: row.firstStaffReplyAt,
    resolutionNote: row.resolutionNote,
  };
}

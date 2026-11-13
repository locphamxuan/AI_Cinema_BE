import type {
  KnowledgeArticleStatus,
  KnowledgeIndexStatus,
  KnowledgeSource,
  SupportAudience,
  SupportCloseReason,
  SupportEscalationReason,
  SupportPriority,
  SupportSenderType,
  SupportStatus,
} from '@prisma/client';
import type { SupportQuickReply } from './support-status';

/** What the member app receives for a case; internal notes and Staff-only fields never appear. */
export interface SupportConversationView {
  id: string;
  status: SupportStatus;
  priority: SupportPriority;
  escalationReason: SupportEscalationReason | null;
  aiSummary: string | null;
  lastMessageAt: Date | null;
  lastMemberMessageAt: Date | null;
  lastStaffMessageAt: Date | null;
  escalatedAt: Date | null;
  claimedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  closeReason: SupportCloseReason | null;
  aiResolutionSuggestedAt: Date | null;
  satisfactionRating: number | null;
  satisfactionComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What Staff sees: the member snapshot plus the operational fields the queue sorts on. */
export interface SupportStaffCaseView extends SupportConversationView {
  memberId: string;
  memberFullName: string;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  escalationNote: string | null;
  aiTurns: number;
  aiFailureCount: number;
  firstStaffReplyAt: Date | null;
  resolutionNote: string | null;
}

export interface SupportMessageView {
  id: string;
  senderType: SupportSenderType;
  content: string;
  isInternal: boolean;
  clientMessageId: string | null;
  replyToMessageId: string | null;
  aiMetadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface SupportSendResult {
  conversation: SupportConversationView;
  memberMessage: SupportMessageView;
  aiMessage: SupportMessageView | null;
  /** System line telling the member the case moved to Staff. */
  systemMessage: SupportMessageView | null;
  quickReplies: SupportQuickReply[];
}

export interface SupportKnowledgeArticleView {
  id: string;
  title: string;
  slug: string;
  category: string;
  audience: SupportAudience;
  locale: string;
  status: KnowledgeArticleStatus;
  source: KnowledgeSource;
  version: number;
  contentHash: string | null;
  indexStatus: KnowledgeIndexStatus;
  indexError: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetrievedKnowledge {
  articleId: string;
  title: string;
  chunkIndex: number;
  heading: string;
  content: string;
  score: number;
}

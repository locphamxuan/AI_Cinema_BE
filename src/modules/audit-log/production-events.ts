import { ComplianceResult, ProductionPlanStatus } from '@prisma/client';
import { AuditEvent, type AuditContext } from './audit-event.decorator';

/** Event names of PROJECT_OVERVIEW.md §4.1.4, plus the ones MF-1 added since. */
export const PRODUCTION_EVENT = {
  PROJECT_CREATED: 'PROJECT_CREATED',
  PROJECT_CANCELLED: 'PROJECT_CANCELLED',
  PLAN_SUBMITTED: 'PRODUCTION_PLAN_SUBMITTED',
  PLAN_APPROVED: 'PRODUCTION_PLAN_APPROVED',
  PLAN_CHANGES_REQUESTED: 'PRODUCTION_PLAN_CHANGES_REQUESTED',
  QUOTA_ALLOCATED: 'EPISODE_QUOTA_ALLOCATED',
  QUOTA_TOPUP_REQUESTED: 'QUOTA_TOPUP_REQUESTED',
  QUOTA_TOPUP_APPROVED: 'QUOTA_TOPUP_APPROVED',
  QUOTA_TOPUP_REJECTED: 'QUOTA_TOPUP_REJECTED',
  GENERATION_COMPLETED: 'GENERATION_COMPLETED',
  GENERATION_FAILED: 'GENERATION_FAILED',
  EPISODE_ASSEMBLED: 'EPISODE_ASSEMBLED',
  EPISODE_SUBMITTED: 'EPISODE_SUBMITTED',
  EPISODE_APPROVED: 'EPISODE_APPROVED',
  CONTENT_CHANGES_REQUESTED: 'CONTENT_CHANGES_REQUESTED',
  EPISODE_REJECTED: 'EPISODE_REJECTED',
  COMPLIANCE_PASSED: 'COMPLIANCE_PASSED',
  COMPLIANCE_CHANGES_REQUESTED: 'COMPLIANCE_CHANGES_REQUESTED',
  EPISODE_SCHEDULED: 'EPISODE_SCHEDULED',
  EPISODE_PUBLISHED: 'EPISODE_PUBLISHED',
  EPISODE_UNPUBLISHED: 'EPISODE_UNPUBLISHED',
} as const;

const E = PRODUCTION_EVENT;
const pick =
  (source: 'body' | 'response', ...keys: string[]) =>
  (ctx: AuditContext): Record<string, unknown> => {
    const values: Record<string, unknown> = {};
    for (const key of keys) if (ctx[source][key] !== undefined) values[key] = ctx[source][key];
    return values;
  };

/** A plan review round closes once every field is decided; only the closing decision is an event. */
async function planVerdict({ response, prisma }: AuditContext) {
  const plan = await prisma.productionPlan.findUnique({
    where: { id: String(response.productionPlanId) },
    select: { status: true },
  });
  if (plan?.status === ProductionPlanStatus.APPROVED) return E.PLAN_APPROVED;
  if (plan?.status === ProductionPlanStatus.CHANGES_REQUESTED) return E.PLAN_CHANGES_REQUESTED;
  return null;
}

const REVIEW_EVENT: Record<string, string> = {
  APPROVED: E.EPISODE_APPROVED,
  CHANGES_REQUESTED: E.CONTENT_CHANGES_REQUESTED,
  REJECTED: E.EPISODE_REJECTED,
};

/** Ready-made @AuditEvent decorators, one per audited route. */
export const Audit = {
  projectCreated: () =>
    AuditEvent({ action: E.PROJECT_CREATED, entity: 'ProductionProject', payload: pick('response', 'title') }),
  projectCancelled: () =>
    AuditEvent({
      action: E.PROJECT_CANCELLED,
      entity: 'ProductionProject',
      idParam: 'projectId',
      payload: pick('body', 'reason'),
    }),
  planSubmitted: () =>
    AuditEvent({
      action: E.PLAN_SUBMITTED,
      entity: 'ProductionPlan',
      idParam: 'planId',
      payload: pick('response', 'episodeNumber'),
    }),
  planReviewDecided: () =>
    AuditEvent({
      action: planVerdict,
      entity: 'PlanReview',
      idParam: 'planReviewId',
      payload: pick('body', 'comments'),
    }),
  quotaAllocated: () =>
    AuditEvent({
      action: E.QUOTA_ALLOCATED,
      entity: 'ProductionPlan',
      idParam: 'planId',
      payload: pick('body', 'allocatedAmount'),
    }),
  quotaRequested: () =>
    AuditEvent({
      action: E.QUOTA_TOPUP_REQUESTED,
      entity: 'QuotaRequest',
      payload: pick('body', 'requestedAmount', 'reason'),
    }),
  quotaApproved: () =>
    AuditEvent({
      action: E.QUOTA_TOPUP_APPROVED,
      entity: 'QuotaRequest',
      idParam: 'quotaRequestId',
      payload: pick('body', 'approvedAmount'),
    }),
  quotaRejected: () =>
    AuditEvent({
      action: E.QUOTA_TOPUP_REJECTED,
      entity: 'QuotaRequest',
      idParam: 'quotaRequestId',
      payload: pick('body', 'note'),
    }),
  episodeAssembled: () =>
    AuditEvent({ action: E.EPISODE_ASSEMBLED, entity: 'EpisodePackage', payload: pick('response', 'packageVersion') }),
  episodeSubmitted: () => AuditEvent({ action: E.EPISODE_SUBMITTED, entity: 'EpisodePackage', idParam: 'packageId' }),
  contentReviewed: () =>
    AuditEvent({
      action: ({ body }) => REVIEW_EVENT[String(body.decision)] ?? null,
      entity: 'Review',
      idParam: 'reviewId',
      payload: pick('body', 'comments'),
    }),
  complianceReviewed: () =>
    AuditEvent({
      action: ({ response }) =>
        response.verdict === ComplianceResult.PASS
          ? E.COMPLIANCE_PASSED
          : response.verdict === ComplianceResult.FAIL
            ? E.COMPLIANCE_CHANGES_REQUESTED
            : null,
      entity: 'EpisodePackage',
      idParam: 'packageId',
    }),
  episodeScheduled: () =>
    AuditEvent({
      action: ({ response }) =>
        response.scheduledAt instanceof Date && response.scheduledAt > new Date() ? E.EPISODE_SCHEDULED : null,
      entity: 'Publication',
      payload: pick('response', 'scheduledAt'),
    }),
  episodePublished: () => AuditEvent({ action: E.EPISODE_PUBLISHED, entity: 'Publication', idParam: 'publicationId' }),
  episodeUnpublished: () =>
    AuditEvent({ action: E.EPISODE_UNPUBLISHED, entity: 'Publication', idParam: 'publicationId' }),
};

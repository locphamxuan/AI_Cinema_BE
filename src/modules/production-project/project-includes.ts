import { Prisma } from '@prisma/client';

/** Relations returned with every project. */
export const PROJECT_INCLUDE = {
  assignedCreator: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  milestones: {
    orderBy: [{ targetDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  },
  productionProjectGenres: { include: { genre: true } },
  projectPolicies: { include: { policy: true } },
} satisfies Prisma.ProductionProjectInclude;

/** The episode plans listed right after a project is created. */
export const CREATED_PLANS_INCLUDE = {
  ...PROJECT_INCLUDE,
  productionPlans: {
    select: {
      id: true,
      episodeNumber: true,
      seasonNumber: true,
      seasonEpisodeNumber: true,
      planVersion: true,
      status: true,
      totalSceneCount: true,
      completedSceneCount: true,
    },
    orderBy: [{ episodeNumber: 'asc' }, { planVersion: 'desc' }],
  },
} satisfies Prisma.ProductionProjectInclude;

/**
 * Everything the workspace needs to show where each episode is in MF-1,
 * newest plan version first per episode.
 */
export const PROJECT_DETAIL_INCLUDE = {
  ...PROJECT_INCLUDE,
  productionPlans: {
    orderBy: [{ episodeNumber: 'asc' }, { planVersion: 'desc' }],
    include: {
      scenes: { orderBy: { sceneNumber: 'asc' } },
      planReviews: {
        orderBy: { createdAt: 'asc' },
        include: { reviewer: { select: { id: true, fullName: true } } },
      },
      quotaAllocations: {
        orderBy: { createdAt: 'asc' },
        include: { allocatedBy: { select: { id: true, fullName: true } } },
      },
      // Top-up requests, newest first: the pending one is what the Reviewer decides.
      quotaRequests: {
        orderBy: { createdAt: 'desc' },
        include: {
          requestedBy: { select: { id: true, fullName: true } },
          decidedBy: { select: { id: true, fullName: true } },
        },
      },
      _count: { select: { generationJobs: true } },
      // Newest package first; older ones keep their content reviews in the history.
      episodePackages: {
        orderBy: { packageVersion: 'desc' },
        include: {
          submissions: { orderBy: { createdAt: 'desc' }, take: 1 },
          // Every content review, newest first: the Creator reads them as feedback history.
          reviews: {
            orderBy: { createdAt: 'desc' },
            include: { reviewer: { select: { id: true, fullName: true } } },
          },
          complianceChecks: true,
          aiContentLabels: true,
          subtitles: { select: { language: true } },
          currentForEpisode: {
            select: {
              id: true,
              productionStatus: true,
              publications: { orderBy: { publishedAt: 'desc' }, take: 1 },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductionProjectInclude;

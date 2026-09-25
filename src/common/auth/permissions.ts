import { UserRole } from '@prisma/client';

/**
 * Every permission the platform checks (PROJECT_OVERVIEW.md §2.2). The keys are stored in
 * the `permissions` table; which role holds which key lives in `role_permissions` and is
 * edited by the Admin. Endpoints name the keys they need with @RequirePermission().
 */
export const PERMISSION = {
  // MF-1 — production
  PRODUCTION_READ: 'production:read',
  PROJECT_MANAGE: 'production:project.manage',
  MILESTONE_UPDATE: 'production:milestone.update',
  PLAN_WRITE: 'production:plan.write',
  PLAN_REVIEW: 'production:plan.review',
  QUOTA_REQUEST: 'production:quota.request',
  QUOTA_MANAGE: 'production:quota.manage',
  PRODUCTION_GENERATE: 'production:generate',
  EPISODE_SUBMIT: 'episode:submit',
  EPISODE_REVIEW: 'episode:review',
  MOVIE_PUBLISH: 'movie:publish',
  GENRE_MANAGE: 'genre:manage',
  GENRE_STYLE_MANAGE: 'genre-style:manage',
  // MF-5 — operations
  FILM_ANALYTICS_READ: 'film:analytics.read',
  MEMBER_OPS_READ: 'member:ops.read',
  BILLING_READ: 'billing:read',
  SUPPORT_MANAGE: 'support:manage',
  MARKETING_MANAGE: 'marketing:manage',
  // Administration
  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  PLATFORM_SETTINGS_MANAGE: 'platform:settings.manage',
} as const;

export type PermissionKey = (typeof PERMISSION)[keyof typeof PERMISSION];

export const ALL_PERMISSIONS = Object.values(PERMISSION) as PermissionKey[];

/**
 * The Admin can never take these away from ADMIN, so an Admin cannot lock every
 * Admin out of user and permission management.
 */
export const LOCKED_ADMIN_PERMISSIONS: PermissionKey[] = [PERMISSION.USER_MANAGE, PERMISSION.ROLE_MANAGE];

/** Defaults seeded by the migration (the §2.2 matrix); kept here for tests and for resetting a role. */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  MEMBER: [],
  CONTENT_CREATOR: [
    PERMISSION.PRODUCTION_READ,
    PERMISSION.MILESTONE_UPDATE,
    PERMISSION.PLAN_WRITE,
    PERMISSION.QUOTA_REQUEST,
    PERMISSION.PRODUCTION_GENERATE,
    PERMISSION.EPISODE_SUBMIT,
  ],
  CONTENT_REVIEWER: [
    PERMISSION.PRODUCTION_READ,
    PERMISSION.PROJECT_MANAGE,
    PERMISSION.MILESTONE_UPDATE,
    PERMISSION.PLAN_REVIEW,
    PERMISSION.QUOTA_MANAGE,
    PERMISSION.EPISODE_REVIEW,
    PERMISSION.MOVIE_PUBLISH,
    PERMISSION.GENRE_MANAGE,
    PERMISSION.GENRE_STYLE_MANAGE,
    PERMISSION.USER_READ,
  ],
  STAFF: [
    PERMISSION.FILM_ANALYTICS_READ,
    PERMISSION.MEMBER_OPS_READ,
    PERMISSION.BILLING_READ,
    PERMISSION.SUPPORT_MANAGE,
    PERMISSION.MARKETING_MANAGE,
  ],
  // Oversight only in production (§2.2): the Admin reads projects but never plans, reviews or publishes.
  ADMIN: [
    PERMISSION.PRODUCTION_READ,
    PERMISSION.FILM_ANALYTICS_READ,
    PERMISSION.MEMBER_OPS_READ,
    PERMISSION.BILLING_READ,
    PERMISSION.SUPPORT_MANAGE,
    PERMISSION.MARKETING_MANAGE,
    PERMISSION.USER_READ,
    PERMISSION.USER_MANAGE,
    PERMISSION.ROLE_MANAGE,
    PERMISSION.PLATFORM_SETTINGS_MANAGE,
  ],
};

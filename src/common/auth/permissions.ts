import { UserRole } from '@prisma/client';

/**
 * Every permission the API checks (PROJECT_OVERVIEW.md §2.2). The keys live in the
 * `permissions` table; which role holds which key lives in `role_permissions` and is edited
 * by the Admin. Endpoints name the keys they need with @RequirePermission(). Ownership
 * (a Reviewer's own projects, a Creator's assigned ones) is checked on top of these.
 */
export const PERMISSION = {
  // MF-1 — movie projects
  PROJECT_MANAGE: 'project:manage',
  PROJECT_FEE_ALLOCATE: 'project:fee.allocate',
  PROJECT_READ_ALL: 'project:read.all',
  PROJECT_SUGGEST: 'project:suggest',
  STUDIO_HANDOFF: 'studio:handoff',
  MEDIA_INGEST: 'media:ingest',
  CONTENT_REVIEW: 'content:review',
  EPISODE_PUBLISH: 'episode:publish',
  PRICE_ALERT_MANAGE: 'price-alert:manage',
  GENRE_MANAGE: 'genre:manage',
  // Administration
  MEMBER_OPS_READ: 'member:ops.read',
  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  PLATFORM_SETTINGS_MANAGE: 'platform:settings.manage',
} as const;

export type PermissionKey = (typeof PERMISSION)[keyof typeof PERMISSION];

/** Area (groups the Admin screen) and description of every permission, seeded into `permissions`. */
export const PERMISSION_CATALOG: Record<PermissionKey, { area: string; description: string }> = {
  'project:manage': {
    area: 'movie-project',
    description: 'Create movie projects, edit their seasons, episodes and idea files, assign a Creator, cancel them',
  },
  'project:fee.allocate': {
    area: 'movie-project',
    description: 'Allocate, top up and correct production fees (Token)',
  },
  'project:read.all': { area: 'movie-project', description: "Read every movie project, not only one's own" },
  'project:suggest': { area: 'movie-project', description: 'Propose changes to a movie project (BR-55)' },
  'studio:handoff': { area: 'studio', description: 'Hand an assigned project off to a studio, change the studio' },
  'media:ingest': { area: 'media', description: 'Upload the episodes, subtitles and artwork a studio delivers' },
  'content:review': {
    area: 'review',
    description: 'Review delivered episodes, apply the AI label, run the compliance check',
  },
  'episode:publish': { area: 'publishing', description: 'Price, schedule, publish and unpublish episodes' },
  'price-alert:manage': { area: 'publishing', description: 'Follow out-of-range Coin prices and ask for a change' },
  'genre:manage': { area: 'catalog', description: 'Add genres' },
  'member:ops.read': { area: 'administration', description: 'Read member accounts (read-only, BR-20)' },
  'user:read': { area: 'administration', description: 'Read every account, staff included' },
  'user:manage': { area: 'administration', description: 'Create staff accounts, change roles, lock accounts' },
  'role:manage': { area: 'administration', description: 'Choose the permissions of every role' },
  'platform:settings.manage': {
    area: 'administration',
    description: 'Change platform policies (rates, price range, free episodes)',
  },
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_CATALOG) as PermissionKey[];

/**
 * The Admin can never take these away from ADMIN, so an Admin cannot lock every
 * Admin out of user and permission management.
 */
export const LOCKED_ADMIN_PERMISSIONS: PermissionKey[] = [PERMISSION.USER_MANAGE, PERMISSION.ROLE_MANAGE];

/** The §2.2 matrix, seeded for a role that has no permission yet. */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  MEMBER: [],
  CONTENT_CREATOR: [PERMISSION.STUDIO_HANDOFF, PERMISSION.MEDIA_INGEST],
  CONTENT_REVIEWER: [
    PERMISSION.PROJECT_MANAGE,
    PERMISSION.PROJECT_FEE_ALLOCATE,
    PERMISSION.CONTENT_REVIEW,
    PERMISSION.EPISODE_PUBLISH,
    PERMISSION.GENRE_MANAGE,
    PERMISSION.USER_READ,
  ],
  STAFF: [PERMISSION.MEMBER_OPS_READ],
  // Oversight only in MF-1: the Admin reads every project and proposes changes, never edits them (BR-55).
  ADMIN: [
    PERMISSION.PROJECT_READ_ALL,
    PERMISSION.PROJECT_SUGGEST,
    PERMISSION.PRICE_ALERT_MANAGE,
    PERMISSION.GENRE_MANAGE,
    PERMISSION.USER_READ,
    PERMISSION.USER_MANAGE,
    PERMISSION.ROLE_MANAGE,
    PERMISSION.PLATFORM_SETTINGS_MANAGE,
  ],
};

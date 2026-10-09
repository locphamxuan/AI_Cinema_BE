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
  // MF-2 — episode access, Coin, monthly plan
  ACCESS_EPISODE_READ: 'access.episode.read',
  WALLET_READ: 'wallet.read',
  WALLET_TOPUP: 'wallet.topup',
  REWARD_CHECKIN: 'reward.checkin',
  SUBSCRIPTION_SELF_MANAGE: 'subscription.self.manage',
  BILLING_PLAN_MANAGE: 'billing.plan.manage',
  BILLING_PRICE_MANAGE: 'billing.price.manage',
  BILLING_SUBSCRIPTION_READ: 'billing.subscription.read',
  BILLING_SUBSCRIPTION_CANCEL: 'billing.subscription.cancel',
  COIN_WALLET_READ: 'coin.wallet.read',
  COIN_ADJUST: 'coin.adjust',
  COIN_TRANSACTION_READ: 'coin.transaction.read',
  REWARD_RULE_MANAGE: 'reward.rule.manage',
  ANALYTICS_REVENUE_READ: 'analytics.revenue.read',
  ANALYTICS_CHURN_READ: 'analytics.churn.read',
  // Administration
  MEMBER_OPS_READ: 'member:ops.read',
  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  PLATFORM_SETTINGS_MANAGE: 'platform:settings.manage',
  TOKEN_BUDGET_MANAGE: 'token-budget:manage',
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
  'access.episode.read': {
    area: 'episode-access',
    description: "Read the access decision of another member's episode",
  },
  'wallet.read': { area: 'episode-access', description: 'Read the Coin balance and the affordability of a purchase' },
  'wallet.topup': { area: 'episode-access', description: 'Create a Coin top-up order with a payment gateway' },
  'reward.checkin': { area: 'episode-access', description: 'Claim the daily check-in reward' },
  'subscription.self.manage': {
    area: 'episode-access',
    description: 'Start, activate, stop auto-renew or resume it on own plan',
  },
  'billing.plan.manage': { area: 'billing', description: 'Create, edit, show and hide membership plans' },
  'billing.price.manage': { area: 'billing', description: 'Set the Coin price of a plan' },
  'billing.subscription.read': { area: 'billing', description: 'Read every subscription and its billing cycles' },
  'billing.subscription.cancel': { area: 'billing', description: "End a member's plan" },
  'coin.wallet.read': { area: 'coin', description: "Read another member's wallet and bonus lots" },
  'coin.adjust': { area: 'coin', description: 'Correct a Coin balance by hand' },
  'coin.transaction.read': { area: 'coin', description: 'Read the Coin ledger of the whole platform' },
  'reward.rule.manage': { area: 'coin', description: 'Configure the daily check-in reward ladder' },
  'analytics.revenue.read': { area: 'billing', description: 'Read the plan revenue reports' },
  'analytics.churn.read': { area: 'billing', description: 'Read the plan churn reports' },
  'member:ops.read': { area: 'administration', description: 'Read member accounts (read-only, BR-20)' },
  'user:read': { area: 'administration', description: 'Read every account, staff included' },
  'user:manage': { area: 'administration', description: 'Create staff accounts, change roles, lock accounts' },
  'role:manage': { area: 'administration', description: 'Choose the permissions of every role' },
  'platform:settings.manage': {
    area: 'administration',
    description: 'Change platform policies (rates, price range, free episodes)',
  },
  'token-budget:manage': {
    area: 'administration',
    description: 'Grant Token to Reviewers and take back what they have not allocated',
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
  // MF-2: a Member buys episodes, tops up Coins, checks in and runs their own plan.
  MEMBER: [
    PERMISSION.ACCESS_EPISODE_READ,
    PERMISSION.WALLET_READ,
    PERMISSION.WALLET_TOPUP,
    PERMISSION.REWARD_CHECKIN,
    PERMISSION.SUBSCRIPTION_SELF_MANAGE,
  ],
  CONTENT_CREATOR: [PERMISSION.STUDIO_HANDOFF, PERMISSION.MEDIA_INGEST],
  CONTENT_REVIEWER: [
    PERMISSION.PROJECT_MANAGE,
    PERMISSION.PROJECT_FEE_ALLOCATE,
    PERMISSION.CONTENT_REVIEW,
    PERMISSION.EPISODE_PUBLISH,
    PERMISSION.GENRE_MANAGE,
    PERMISSION.USER_READ,
  ],
  // Billing and Coin support: read-only, changes go through the Admin.
  STAFF: [
    PERMISSION.MEMBER_OPS_READ,
    PERMISSION.ACCESS_EPISODE_READ,
    PERMISSION.WALLET_READ,
    PERMISSION.COIN_WALLET_READ,
    PERMISSION.COIN_TRANSACTION_READ,
    PERMISSION.BILLING_SUBSCRIPTION_READ,
  ],
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
    PERMISSION.TOKEN_BUDGET_MANAGE,
    // MF-2: the Billing Admin configures plans and prices, ends plans and reads the Coin ledger.
    PERMISSION.ACCESS_EPISODE_READ,
    PERMISSION.WALLET_READ,
    PERMISSION.BILLING_PLAN_MANAGE,
    PERMISSION.BILLING_PRICE_MANAGE,
    PERMISSION.BILLING_SUBSCRIPTION_READ,
    PERMISSION.BILLING_SUBSCRIPTION_CANCEL,
    PERMISSION.COIN_WALLET_READ,
    PERMISSION.COIN_ADJUST,
    PERMISSION.COIN_TRANSACTION_READ,
    PERMISSION.REWARD_RULE_MANAGE,
    PERMISSION.ANALYTICS_REVENUE_READ,
    PERMISSION.ANALYTICS_CHURN_READ,
  ],
};

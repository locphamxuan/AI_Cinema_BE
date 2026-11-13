import { UserRole } from '@prisma/client';

/**
 * Every permission the API checks (PROJECT_OVERVIEW.md §2.2). The keys live in the
 * `permissions` table; which role holds which key lives in `role_permissions` and is edited
 * by the Admin. Endpoints name the keys they need with @RequirePermission(). Ownership
 * (a Reviewer's own projects, a Creator's assigned ones) is checked on top of these.
 */
export const PERMISSION = {
  // MF-1 - movie projects
  PROJECT_CREATE: 'project:create',
  PROJECT_MANAGE: 'project:manage',
  PROJECT_READ_ALL: 'project:read.all',
  PROJECT_SUGGEST: 'project:suggest',
  PROJECT_CHANGE_REVIEW: 'project:change.review',
  COST_REQUEST: 'cost:request',
  COST_APPROVE: 'cost:approve',
  COST_ADJUST: 'cost:adjust',
  CONTRACT_MANAGE: 'contract:manage',
  CONTRACT_DOCUMENT_READ: 'contract:document.read',
  SCRIPT_WRITE: 'script:write',
  SCRIPT_APPROVE: 'script:approve',
  STUDIO_PORTAL: 'studio:portal',
  STUDIO_MANAGE: 'studio:manage',
  MEDIA_INGEST: 'media:ingest',
  CONTENT_REVIEW: 'content:review',
  EPISODE_PRICE: 'episode:price',
  EPISODE_PUBLISH: 'episode:publish',
  PRICE_ALERT_MANAGE: 'price-alert:manage',
  GENRE_MANAGE: 'genre:manage',
  // MF-2 - episode access, Coin, monthly plan
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
  // MF-3 — mid-roll ads
  AD_MANAGE: 'ad.manage',
  // AI Customer Support
  SUPPORT_CHAT: 'support:chat',
  WATCH_PARTY: 'watch-party:use',
  SUPPORT_CASE_READ: 'support:case.read',
  SUPPORT_CASE_MANAGE: 'support:case.manage',
  SUPPORT_CASE_ASSIGN: 'support:case.assign',
  SUPPORT_KNOWLEDGE_MANAGE: 'support:knowledge.manage',
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
  'project:create': {
    area: 'movie-project',
    description: 'Create a movie project, pick its Reviewer, Creator and studio, reassign the Creator',
  },
  'project:manage': {
    area: 'movie-project',
    description: 'Create movie projects, edit their seasons, episodes and idea files, assign a Creator, cancel them',
  },
  'project:read.all': { area: 'movie-project', description: "Read every movie project, not only one's own" },
  'project:suggest': {
    area: 'movie-project',
    description: 'Send the Admin a change request for a project, with the reason and proof (BR-55)',
  },
  'project:change.review': {
    area: 'movie-project',
    description: 'Approve or reject the change requests of Reviewers and Creators (BR-55)',
  },
  'cost:request': {
    area: 'movie-project',
    description: 'Ask the Admin for more production cost (VND), with the studio quote as proof',
  },
  'cost:approve': {
    area: 'movie-project',
    description: 'Grant (in full or in part) or refuse the production cost requests of Reviewers',
  },
  'cost:adjust': { area: 'movie-project', description: 'Set the production budget (VND) of a project and correct it' },
  'contract:manage': {
    area: 'movie-project',
    description: 'Send the studio a contract template, upload the signed contract PDF or counter-propose its cost',
  },
  'contract:document.read': {
    area: 'movie-project',
    description: 'Download the signed contract PDFs of a project',
  },
  'script:write': { area: 'movie-project', description: 'Write and submit the script of an assigned project' },
  'script:approve': {
    area: 'movie-project',
    description: 'Approve the Final Script (the system then sends the studio its contract) or send it back',
  },
  'studio:portal': {
    area: 'studio',
    description: 'Studio account: negotiate and sign its contracts, read its projects, deliver films',
  },
  'studio:manage': { area: 'studio', description: 'Keep the catalog of partner studios: add, edit, deactivate' },
  'media:ingest': {
    area: 'media',
    description:
      'Work on the episodes of an assigned project: team, delegations, episode notes (films come from the studio)',
  },
  'content:review': {
    area: 'review',
    description: 'Review delivered episodes, apply the AI label, run the compliance check',
  },
  'episode:price': {
    area: 'publishing',
    description: 'Set the Coin price and the free flags of each episode before publishing (Admin, BR-29)',
  },
  'episode:publish': {
    area: 'publishing',
    description: 'Publish, schedule and unpublish episodes once the Reviewer confirmed the Final Film',
  },
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
  'ad.manage': { area: 'advertising', description: 'Create ads and pause or resume them' },
  // AI Customer Support
  'support:chat': { area: 'support', description: 'Member mở chat hỗ trợ' },
  'watch-party:use': { area: 'playback', description: 'Member xem phim nhóm và kết bạn' },
  'support:case.read': { area: 'support', description: 'Staff/ADMIN đọc support case' },
  'support:case.manage': { area: 'support', description: 'Staff manage case: claim, reply, resolve, close' },
  'support:case.assign': { area: 'support', description: 'ADMIN gán case cho Staff' },
  'support:knowledge.manage': { area: 'support', description: 'Admin quản lý Knowledge Base' },
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
  // MF-2: a Member buys episodes, tops up Coins, checks in and runs their own plan.
  MEMBER: [
    PERMISSION.ACCESS_EPISODE_READ,
    PERMISSION.WALLET_READ,
    PERMISSION.WALLET_TOPUP,
    PERMISSION.REWARD_CHECKIN,
    PERMISSION.SUBSCRIPTION_SELF_MANAGE,
    PERMISSION.SUPPORT_CHAT,
    PERMISSION.WATCH_PARTY,
  ],
  CONTENT_CREATOR: [PERMISSION.PROJECT_SUGGEST, PERMISSION.SCRIPT_WRITE, PERMISSION.MEDIA_INGEST],
  // 2026-11-11: the Reviewer stops at the Final Film and the AI label; pricing moved to the Admin.
  CONTENT_REVIEWER: [
    PERMISSION.PROJECT_MANAGE,
    PERMISSION.PROJECT_SUGGEST,
    PERMISSION.COST_REQUEST,
    PERMISSION.CONTENT_REVIEW,
    PERMISSION.CONTRACT_DOCUMENT_READ,
    PERMISSION.GENRE_MANAGE,
    PERMISSION.USER_READ,
  ],
  // MF-1 (07/11/2026): a partner studio negotiates its contracts and delivers its films, nothing else.
  STUDIO: [PERMISSION.STUDIO_PORTAL],
  // Billing and Coin support: read-only, changes go through the Admin.
  STAFF: [
    PERMISSION.MEMBER_OPS_READ,
    PERMISSION.ACCESS_EPISODE_READ,
    PERMISSION.WALLET_READ,
    PERMISSION.COIN_WALLET_READ,
    PERMISSION.COIN_TRANSACTION_READ,
    PERMISSION.BILLING_SUBSCRIPTION_READ,
    PERMISSION.SUPPORT_CASE_READ,
    PERMISSION.SUPPORT_CASE_MANAGE,
  ],
  // MF-1: the Admin creates projects, approves the Final Script, publishes, reads every project, sets its production budget and decides the change and cost requests (BR-55).
  ADMIN: [
    PERMISSION.PROJECT_CREATE,
    PERMISSION.PROJECT_READ_ALL,
    PERMISSION.SCRIPT_APPROVE,
    PERMISSION.STUDIO_MANAGE,
    PERMISSION.EPISODE_PRICE,
    PERMISSION.EPISODE_PUBLISH,
    PERMISSION.PROJECT_CHANGE_REVIEW,
    PERMISSION.COST_APPROVE,
    PERMISSION.COST_ADJUST,
    PERMISSION.CONTRACT_MANAGE,
    PERMISSION.CONTRACT_DOCUMENT_READ,
    PERMISSION.PRICE_ALERT_MANAGE,
    PERMISSION.GENRE_MANAGE,
    PERMISSION.USER_READ,
    PERMISSION.USER_MANAGE,
    PERMISSION.ROLE_MANAGE,
    PERMISSION.PLATFORM_SETTINGS_MANAGE,
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
    // MF-3: mid-roll ads shown to ad-supported plans.
    PERMISSION.AD_MANAGE,
    // AI Customer Support
    PERMISSION.SUPPORT_CASE_READ,
    PERMISSION.SUPPORT_CASE_MANAGE,
    PERMISSION.SUPPORT_CASE_ASSIGN,
    PERMISSION.SUPPORT_KNOWLEDGE_MANAGE,
  ],
};

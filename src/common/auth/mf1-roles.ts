import { UserRole } from '@prisma/client';

// MF-1 actors (PROJECT_OVERVIEW.md §3): Creator produces, Reviewer plans/approves/publishes.
// Members and staff never touch production data.
export const MF1_ROLES = [UserRole.CONTENT_CREATOR, UserRole.CONTENT_REVIEWER, UserRole.ADMIN];
export const CREATOR_ROLES = [UserRole.CONTENT_CREATOR, UserRole.ADMIN];
export const REVIEWER_ROLES = [UserRole.CONTENT_REVIEWER, UserRole.ADMIN];

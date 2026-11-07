-- MF-1 (07/11/2026): a partner studio logs into AI Cinema with its own account. The new enum value lives in a
-- migration of its own: PostgreSQL cannot use a value added in the same transaction (the next migration's CHECK).
ALTER TYPE "UserRole" ADD VALUE 'STUDIO';

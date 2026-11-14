-- AlterTable
ALTER TABLE "streaming_sessions" ADD COLUMN     "duration_seconds" INTEGER,
ADD COLUMN     "last_progress_at" TIMESTAMPTZ(6);

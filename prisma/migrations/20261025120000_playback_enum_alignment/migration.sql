-- Playback enums follow the business spec: the MF-2 handoff access_type
-- (FREE_STARTER | SUBSCRIPTION | COIN_UNLOCK, plus ADMIN_GRANT) and BR-33's PENDING -> COMPLETED
-- ad break. Values nothing ever wrote are dropped: SERIES_PURCHASE (no series purchase exists),
-- session statuses EXPIRED/KICKED (why a session closed is end_reason) and end reason ERROR.
-- Each type is rebuilt so renamed and dropped values move in one statement per column.

-- PlaybackAccessType
ALTER TYPE "PlaybackAccessType" RENAME TO "PlaybackAccessType_old";
CREATE TYPE "PlaybackAccessType" AS ENUM ('FREE_STARTER', 'SUBSCRIPTION', 'COIN_UNLOCK', 'ADMIN_GRANT');
ALTER TABLE "streaming_sessions" ALTER COLUMN "access_type" TYPE "PlaybackAccessType" USING (
  CASE "access_type"::text
    WHEN 'PLAN' THEN 'SUBSCRIPTION'
    WHEN 'EPISODE_PURCHASE' THEN 'COIN_UNLOCK'
    WHEN 'SERIES_PURCHASE' THEN 'COIN_UNLOCK'
    ELSE "access_type"::text
  END
)::"PlaybackAccessType";
DROP TYPE "PlaybackAccessType_old";

-- StreamingSessionStatus
ALTER TYPE "StreamingSessionStatus" RENAME TO "StreamingSessionStatus_old";
CREATE TYPE "StreamingSessionStatus" AS ENUM ('ACTIVE', 'ENDED');
ALTER TABLE "streaming_sessions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "streaming_sessions" ALTER COLUMN "status" TYPE "StreamingSessionStatus" USING (
  CASE "status"::text WHEN 'ACTIVE' THEN 'ACTIVE' ELSE 'ENDED' END
)::"StreamingSessionStatus";
ALTER TABLE "streaming_sessions" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DROP TYPE "StreamingSessionStatus_old";

-- StreamingEndReason
ALTER TYPE "StreamingEndReason" RENAME TO "StreamingEndReason_old";
CREATE TYPE "StreamingEndReason" AS ENUM ('COMPLETED', 'STOPPED', 'EXPIRED', 'KICKED', 'SUPERSEDED');
ALTER TABLE "streaming_sessions" ALTER COLUMN "end_reason" TYPE "StreamingEndReason" USING (
  CASE "end_reason"::text WHEN 'ERROR' THEN 'STOPPED' ELSE "end_reason"::text END
)::"StreamingEndReason";
DROP TYPE "StreamingEndReason_old";

-- AdBreakStatus
ALTER TYPE "AdBreakStatus" RENAME TO "AdBreakStatus_old";
CREATE TYPE "AdBreakStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');
ALTER TABLE "session_ad_breaks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "session_ad_breaks" ALTER COLUMN "status" TYPE "AdBreakStatus" USING (
  CASE "status"::text
    WHEN 'SCHEDULED' THEN 'PENDING'
    WHEN 'PLAYED' THEN 'COMPLETED'
    ELSE "status"::text
  END
)::"AdBreakStatus";
ALTER TABLE "session_ad_breaks" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "AdBreakStatus_old";

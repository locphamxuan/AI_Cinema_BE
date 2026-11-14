-- Group Watch & Recommendation (2026-11-11, planned)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WatchRoomStatus') THEN
    CREATE TYPE "WatchRoomStatus" AS ENUM ('CREATED', 'WAITING_FOR_PARTICIPANTS', 'PLAYING', 'PAUSED', 'ENDED', 'DISBANDED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoomParticipantRole') THEN
    CREATE TYPE "RoomParticipantRole" AS ENUM ('HOST', 'PARTICIPANT');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FriendshipStatus') THEN
    CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');
  END IF;
END $$;

ALTER TABLE "movies" ADD COLUMN "country" VARCHAR(50);
ALTER TABLE "episodes" ADD COLUMN "is_free_for_guest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "episodes" ADD COLUMN "is_free_for_member" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "watch_rooms" (
    "id" UUID NOT NULL,
    "room_code" VARCHAR(16) NOT NULL,
    "episode_id" UUID NOT NULL,
    "host_user_id" UUID,
    "status" "WatchRoomStatus" NOT NULL DEFAULT 'CREATED',
    "current_position_seconds" INTEGER NOT NULL DEFAULT 0,
    "last_host_ping_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "watch_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_participants" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "RoomParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_ping_at" TIMESTAMPTZ(6),
    "left_at" TIMESTAMPTZ(6),
    CONSTRAINT "room_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "friendships" (
    "id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "responded_at" TIMESTAMPTZ(6),
    "last_invite_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "watch_rooms" ADD CONSTRAINT "watch_rooms_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "watch_rooms" ADD CONSTRAINT "watch_rooms_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "watch_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "watch_rooms_room_code_key" ON "watch_rooms" ("room_code");
CREATE INDEX "watch_rooms_episode_id_idx" ON "watch_rooms" ("episode_id");
CREATE INDEX "watch_rooms_status_idx" ON "watch_rooms" ("status");
CREATE INDEX "watch_rooms_expires_at_idx" ON "watch_rooms" ("expires_at");
CREATE UNIQUE INDEX "room_participants_room_id_user_id_key" ON "room_participants" ("room_id", "user_id");
CREATE INDEX "room_participants_room_id_idx" ON "room_participants" ("room_id");
CREATE INDEX "room_participants_user_id_idx" ON "room_participants" ("user_id");
CREATE UNIQUE INDEX "friendships_sender_id_receiver_id_key" ON "friendships" ("sender_id", "receiver_id");
CREATE INDEX "friendships_sender_id_status_idx" ON "friendships" ("sender_id", "status");
CREATE INDEX "friendships_receiver_id_status_idx" ON "friendships" ("receiver_id", "status");
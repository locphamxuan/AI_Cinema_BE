-- MF-4: the devices a Member registered (BR-34) and the device each member session plays on (BR-36).
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_devices_user_id_device_key_key" ON "user_devices"("user_id", "device_key");

CREATE INDEX "user_devices_user_id_last_seen_at_idx" ON "user_devices"("user_id", "last_seen_at");

ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "streaming_sessions" ADD COLUMN "device_id" UUID;

CREATE INDEX "streaming_sessions_device_id_idx" ON "streaming_sessions"("device_id");

ALTER TABLE "streaming_sessions" ADD CONSTRAINT "streaming_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "user_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

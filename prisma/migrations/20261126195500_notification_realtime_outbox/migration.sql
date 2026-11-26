CREATE TABLE "notification_realtime_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_realtime_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_realtime_events_created_at_idx"
    ON "notification_realtime_events"("created_at");

ALTER TABLE "notification_realtime_events"
    ADD CONSTRAINT "notification_realtime_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

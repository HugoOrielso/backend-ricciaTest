-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "quiz_sessions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "name" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "recommended_kits" JSONB NOT NULL DEFAULT '[]',
    "kit_consigliato" TEXT,
    "coupon_code" TEXT,
    "coupon_percent" INTEGER,
    "coupon_created_at" TIMESTAMP(3),
    "coupon_expires_at" TIMESTAMP(3),
    "coupon_status" TEXT,
    "klaviyo_synced" BOOLEAN NOT NULL DEFAULT false,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "meta_lead_event_id" TEXT,
    "meta_lead_attempts" INTEGER NOT NULL DEFAULT 0,
    "meta_lead_last_attempt_at" TIMESTAMP(3),
    "meta_lead_sent_at" TIMESTAMP(3),
    "meta_lead_error" TEXT,
    "meta_lead_http_status" INTEGER,
    "meta_lead_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_lead_events" (
    "id" UUID NOT NULL,
    "quiz_session_id" UUID NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "test_mode" BOOLEAN NOT NULL DEFAULT false,
    "attempted_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "http_status" INTEGER,
    "error" TEXT,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quiz_sessions_session_id_key" ON "quiz_sessions"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_sessions_email_normalized_key" ON "quiz_sessions"("email_normalized");

-- CreateIndex
CREATE INDEX "quiz_sessions_coupon_expires_at_idx" ON "quiz_sessions"("coupon_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "meta_lead_events_event_id_key" ON "meta_lead_events"("event_id");

-- CreateIndex
CREATE INDEX "meta_lead_events_quiz_session_id_attempted_at_idx" ON "meta_lead_events"("quiz_session_id", "attempted_at" DESC);

-- AddForeignKey
ALTER TABLE "meta_lead_events" ADD CONSTRAINT "meta_lead_events_quiz_session_id_fkey" FOREIGN KEY ("quiz_session_id") REFERENCES "quiz_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

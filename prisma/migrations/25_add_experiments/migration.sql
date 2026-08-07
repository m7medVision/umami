-- CreateTable
CREATE TABLE "experiment" (
    "experiment_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "feature_flag_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "experiment_pkey" PRIMARY KEY ("experiment_id")
);

-- CreateTable
CREATE TABLE "mutual_exclusion_group" (
    "mutual_exclusion_group_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "mutual_exclusion_group_pkey" PRIMARY KEY ("mutual_exclusion_group_id")
);

-- CreateTable
CREATE TABLE "experiment_run" (
    "experiment_run_id" UUID NOT NULL,
    "experiment_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "feature_flag_id" UUID NOT NULL,
    "mutual_exclusion_group_id" UUID,
    "run_number" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Draft',
    "feature_flag_key" VARCHAR(200) NOT NULL,
    "feature_flag_value_type" VARCHAR(20) NOT NULL,
    "feature_flag_variations" JSONB NOT NULL,
    "variation_weights" JSONB NOT NULL,
    "rollout_percentage" DOUBLE PRECISION NOT NULL,
    "fallthrough_variation" INTEGER NOT NULL,
    "baseline_variation" INTEGER NOT NULL,
    "assignment_policy" JSONB NOT NULL,
    "audience_segment_snapshot" JSONB,
    "exclusion_segment_snapshot" JSONB,
    "statistics_version" VARCHAR(50) NOT NULL,
    "bucketing_version" VARCHAR(50) NOT NULL,
    "statistical_model" JSONB NOT NULL,
    "safeguards" JSONB NOT NULL,
    "readiness_status" VARCHAR(20) NOT NULL DEFAULT 'NotReady',
    "readiness_checks" JSONB,
    "ready_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "first_exposure_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "accumulated_paused_duration_ms" BIGINT NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(6),
    "provisional_until" TIMESTAMPTZ(6),
    "finalized_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "raw_data_retained_until" TIMESTAMPTZ(6),
    "raw_data_expired_at" TIMESTAMPTZ(6),
    "last_computed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "experiment_run_pkey" PRIMARY KEY ("experiment_run_id")
);

-- CreateTable
CREATE TABLE "experiment_outcome" (
    "experiment_outcome_id" UUID NOT NULL,
    "experiment_run_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_value" VARCHAR(200) NOT NULL,
    "numeric_field" VARCHAR(500),
    "counting_mode" VARCHAR(20) NOT NULL,
    "attribution_scope" VARCHAR(20) NOT NULL,
    "visitor_window_days" INTEGER NOT NULL DEFAULT 14,
    "desired_direction" VARCHAR(20) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "currency" VARCHAR(3),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_outcome_pkey" PRIMARY KEY ("experiment_outcome_id")
);

-- CreateTable
CREATE TABLE "experiment_result_snapshot" (
    "experiment_result_snapshot_id" UUID NOT NULL,
    "experiment_run_id" UUID NOT NULL,
    "statistics_version" VARCHAR(50) NOT NULL,
    "results" JSONB NOT NULL,
    "diagnostics" JSONB NOT NULL,
    "safeguard_results" JSONB NOT NULL,
    "source_data_through_at" TIMESTAMPTZ(6) NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_result_snapshot_pkey" PRIMARY KEY ("experiment_result_snapshot_id")
);

-- CreateTable
CREATE TABLE "experiment_promotion" (
    "experiment_promotion_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "experiment_run_id" UUID NOT NULL,
    "feature_flag_id" UUID NOT NULL,
    "winning_variation" INTEGER NOT NULL,
    "previous_flag_snapshot" JSONB NOT NULL,
    "promoted_by" UUID,
    "promoted_at" TIMESTAMPTZ(6) NOT NULL,
    "rolled_back_by" UUID,
    "rolled_back_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "experiment_promotion_pkey" PRIMARY KEY ("experiment_promotion_id")
);

-- CreateTable
CREATE TABLE "experiment_notification" (
    "experiment_notification_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "experiment_id" UUID,
    "experiment_run_id" UUID,
    "type" VARCHAR(50) NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_notification_pkey" PRIMARY KEY ("experiment_notification_id")
);

-- CreateIndex
CREATE INDEX "experiment_website_id_idx" ON "experiment"("website_id");
CREATE INDEX "experiment_feature_flag_id_idx" ON "experiment"("feature_flag_id");
CREATE INDEX "experiment_website_id_archived_at_idx" ON "experiment"("website_id", "archived_at");

CREATE INDEX "mutual_exclusion_group_website_id_idx" ON "mutual_exclusion_group"("website_id");
CREATE INDEX "mutual_exclusion_group_website_id_archived_at_idx" ON "mutual_exclusion_group"("website_id", "archived_at");

CREATE UNIQUE INDEX "experiment_run_experiment_id_run_number_key" ON "experiment_run"("experiment_id", "run_number");
CREATE INDEX "experiment_run_experiment_id_idx" ON "experiment_run"("experiment_id");
CREATE INDEX "experiment_run_website_id_idx" ON "experiment_run"("website_id");
CREATE INDEX "experiment_run_feature_flag_id_idx" ON "experiment_run"("feature_flag_id");
CREATE INDEX "experiment_run_mutual_exclusion_group_id_idx" ON "experiment_run"("mutual_exclusion_group_id");
CREATE INDEX "experiment_run_website_id_status_idx" ON "experiment_run"("website_id", "status");
CREATE INDEX "experiment_run_status_provisional_until_idx" ON "experiment_run"("status", "provisional_until");
CREATE INDEX "experiment_run_status_last_computed_at_idx" ON "experiment_run"("status", "last_computed_at");
CREATE INDEX "experiment_run_raw_data_expired_at_raw_data_retained_until_idx" ON "experiment_run"("raw_data_expired_at", "raw_data_retained_until");

-- PostgreSQL partial indexes enforce the active-Run contract without restricting history or Drafts.
CREATE UNIQUE INDEX "experiment_run_active_feature_flag_key"
ON "experiment_run"("feature_flag_id")
WHERE "status" IN ('Running', 'Paused');

CREATE UNIQUE INDEX "experiment_run_active_experiment_key"
ON "experiment_run"("experiment_id")
WHERE "status" IN ('Running', 'Paused');

CREATE UNIQUE INDEX "experiment_outcome_experiment_run_id_position_key" ON "experiment_outcome"("experiment_run_id", "position");
CREATE INDEX "experiment_outcome_experiment_run_id_idx" ON "experiment_outcome"("experiment_run_id");
CREATE INDEX "experiment_outcome_experiment_run_id_role_idx" ON "experiment_outcome"("experiment_run_id", "role");

CREATE UNIQUE INDEX "experiment_result_snapshot_experiment_run_id_key" ON "experiment_result_snapshot"("experiment_run_id");
CREATE INDEX "experiment_result_snapshot_computed_at_idx" ON "experiment_result_snapshot"("computed_at");

CREATE INDEX "experiment_promotion_website_id_idx" ON "experiment_promotion"("website_id");
CREATE INDEX "experiment_promotion_experiment_run_id_idx" ON "experiment_promotion"("experiment_run_id");
CREATE INDEX "experiment_promotion_feature_flag_id_idx" ON "experiment_promotion"("feature_flag_id");
CREATE INDEX "experiment_promotion_feature_flag_id_promoted_at_idx" ON "experiment_promotion"("feature_flag_id", "promoted_at");
CREATE UNIQUE INDEX "experiment_promotion_active_run_key"
ON "experiment_promotion"("experiment_run_id")
WHERE "rolled_back_at" IS NULL;

CREATE UNIQUE INDEX "experiment_notification_dedupe_key_key" ON "experiment_notification"("dedupe_key");
CREATE INDEX "experiment_notification_website_id_idx" ON "experiment_notification"("website_id");
CREATE INDEX "experiment_notification_experiment_id_idx" ON "experiment_notification"("experiment_id");
CREATE INDEX "experiment_notification_experiment_run_id_idx" ON "experiment_notification"("experiment_run_id");
CREATE INDEX "experiment_notification_website_id_dismissed_at_created_at_idx" ON "experiment_notification"("website_id", "dismissed_at", "created_at");
CREATE INDEX "experiment_notification_website_id_read_at_created_at_idx" ON "experiment_notification"("website_id", "read_at", "created_at");

-- Privacy audit deliberately contains no raw identity or digest column.
CREATE TABLE "experiment_privacy_audit" (
    "experiment_privacy_audit_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "requested_by" UUID,
    "operation" VARCHAR(50) NOT NULL DEFAULT 'visitor-data-deletion',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_privacy_audit_pkey" PRIMARY KEY ("experiment_privacy_audit_id")
);
CREATE INDEX "experiment_privacy_audit_website_id_created_at_idx" ON "experiment_privacy_audit"("website_id", "created_at");

-- CreateTable
CREATE TABLE "feature_flag" (
    "feature_flag_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "value_type" VARCHAR(20) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "variations" JSONB NOT NULL,
    "rollout" JSONB NOT NULL,
    "default_variation" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("feature_flag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_website_id_key_key" ON "feature_flag"("website_id", "key");

-- CreateIndex
CREATE INDEX "feature_flag_website_id_idx" ON "feature_flag"("website_id");

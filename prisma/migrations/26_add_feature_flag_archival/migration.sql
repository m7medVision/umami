-- AlterTable
ALTER TABLE "feature_flag" ADD COLUMN "archived_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "feature_flag_website_id_archived_at_idx" ON "feature_flag"("website_id", "archived_at");

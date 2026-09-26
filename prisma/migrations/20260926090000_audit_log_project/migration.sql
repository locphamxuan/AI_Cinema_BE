-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "production_project_id" UUID;

-- CreateIndex
CREATE INDEX "audit_logs_production_project_id_created_at_idx" ON "audit_logs"("production_project_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

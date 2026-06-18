-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "logtoUserId" TEXT;

-- CreateIndex
CREATE INDEX "Workspace_logtoUserId_idx" ON "Workspace"("logtoUserId");

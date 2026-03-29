-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "currentLevel" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "totalLevels" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "workflowId" TEXT;

-- AlterTable
ALTER TABLE "ApprovalReview" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ApprovalWorkflow" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalWorkflowLevel" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "role" TEXT,
    "assigneeId" TEXT,
    "requireAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalWorkflowLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalWorkflow_accountId_idx" ON "ApprovalWorkflow"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalWorkflow_accountId_name_key" ON "ApprovalWorkflow"("accountId", "name");

-- CreateIndex
CREATE INDEX "ApprovalWorkflowLevel_workflowId_idx" ON "ApprovalWorkflowLevel"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalWorkflowLevel_workflowId_order_key" ON "ApprovalWorkflowLevel"("workflowId", "order");

-- CreateIndex
CREATE INDEX "ApprovalRequest_workflowId_idx" ON "ApprovalRequest"("workflowId");

-- AddForeignKey
ALTER TABLE "ApprovalWorkflow" ADD CONSTRAINT "ApprovalWorkflow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalWorkflowLevel" ADD CONSTRAINT "ApprovalWorkflowLevel_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

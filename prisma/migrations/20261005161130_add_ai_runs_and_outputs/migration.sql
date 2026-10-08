-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCEEDED', 'INVALID_OUTPUT', 'BLOCKED', 'RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'REJECTED_BUDGET');

-- CreateEnum
CREATE TYPE "AiOutputStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "AiRunStatus" NOT NULL,
    "errorClass" TEXT,
    "httpStatus" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "costEstimateMicroUsd" INTEGER,
    "userId" UUID,
    "childId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_outputs" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "status" "AiOutputStatus" NOT NULL DEFAULT 'PENDING',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "inputHash" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "content" JSONB,
    "failureReason" TEXT,
    "requestedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_runs_createdAt_idx" ON "ai_runs"("createdAt");

-- CreateIndex
CREATE INDEX "ai_runs_userId_createdAt_idx" ON "ai_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_outputs_createdAt_idx" ON "ai_outputs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_outputs_childId_capability_forDate_key" ON "ai_outputs"("childId", "capability", "forDate");

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

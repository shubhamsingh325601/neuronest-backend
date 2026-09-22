-- CreateEnum
CREATE TYPE "PlanTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanOrigin" AS ENUM ('MANUAL', 'AI');

-- CreateTable
CREATE TABLE "plan_templates" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "PlanTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_template_days" (
    "id" UUID NOT NULL,
    "planTemplateId" UUID NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,

    CONSTRAINT "plan_template_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "planTemplateId" UUID NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "origin" "PlanOrigin" NOT NULL DEFAULT 'MANUAL',
    "startDate" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_notes" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_template_days_planTemplateId_dayNumber_key" ON "plan_template_days"("planTemplateId", "dayNumber");

-- CreateIndex
CREATE INDEX "plans_childId_idx" ON "plans"("childId");

-- CreateIndex
CREATE INDEX "plan_notes_planId_idx" ON "plan_notes"("planId");

-- AddForeignKey
ALTER TABLE "plan_templates" ADD CONSTRAINT "plan_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_template_days" ADD CONSTRAINT "plan_template_days_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "plan_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "plan_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_notes" ADD CONSTRAINT "plan_notes_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_notes" ADD CONSTRAINT "plan_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

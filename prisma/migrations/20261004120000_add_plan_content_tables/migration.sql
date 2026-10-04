-- AlterTable
ALTER TABLE "plan_template_days" ADD COLUMN     "sectionId" UUID;

-- CreateTable
CREATE TABLE "plan_template_sections" (
    "id" UUID NOT NULL,
    "planTemplateId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "plan_template_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_sections" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "plan_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_days" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "sectionId" UUID,
    "dayNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_template_sections_planTemplateId_position_key" ON "plan_template_sections"("planTemplateId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "plan_sections_planId_position_key" ON "plan_sections"("planId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "plan_days_planId_dayNumber_key" ON "plan_days"("planId", "dayNumber");

-- AddForeignKey
ALTER TABLE "plan_template_sections" ADD CONSTRAINT "plan_template_sections_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "plan_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_template_days" ADD CONSTRAINT "plan_template_days_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "plan_template_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sections" ADD CONSTRAINT "plan_sections_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "plan_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

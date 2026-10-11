-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'EXPERT';

-- CreateTable
CREATE TABLE "expert_child_assignments" (
    "id" UUID NOT NULL,
    "expertId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expert_child_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expert_child_assignments_childId_idx" ON "expert_child_assignments"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "expert_child_assignments_expertId_childId_key" ON "expert_child_assignments"("expertId", "childId");

-- AddForeignKey
ALTER TABLE "expert_child_assignments" ADD CONSTRAINT "expert_child_assignments_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_child_assignments" ADD CONSTRAINT "expert_child_assignments_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

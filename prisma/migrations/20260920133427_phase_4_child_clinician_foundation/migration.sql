-- CreateTable
CREATE TABLE "children" (
    "id" UUID NOT NULL,
    "parentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinician_child_assignments" (
    "id" UUID NOT NULL,
    "clinicianId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "assignedByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinician_child_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "children_parentId_key" ON "children"("parentId");

-- CreateIndex
CREATE INDEX "clinician_child_assignments_childId_idx" ON "clinician_child_assignments"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "clinician_child_assignments_clinicianId_childId_key" ON "clinician_child_assignments"("clinicianId", "childId");

-- AddForeignKey
ALTER TABLE "children" ADD CONSTRAINT "children_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinician_child_assignments" ADD CONSTRAINT "clinician_child_assignments_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinician_child_assignments" ADD CONSTRAINT "clinician_child_assignments_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinician_child_assignments" ADD CONSTRAINT "clinician_child_assignments_assignedByAdminId_fkey" FOREIGN KEY ("assignedByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

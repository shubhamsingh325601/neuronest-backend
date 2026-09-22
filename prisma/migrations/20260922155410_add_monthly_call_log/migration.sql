-- CreateTable
CREATE TABLE "monthly_call_logs" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "clinicianId" UUID NOT NULL,
    "calledAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_call_logs_childId_idx" ON "monthly_call_logs"("childId");

-- AddForeignKey
ALTER TABLE "monthly_call_logs" ADD CONSTRAINT "monthly_call_logs_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_call_logs" ADD CONSTRAINT "monthly_call_logs_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

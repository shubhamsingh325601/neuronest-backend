-- CreateTable
CREATE TABLE "progress_entries" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "planId" UUID,
    "entryDate" DATE NOT NULL,
    "mood" INTEGER,
    "behaviour" INTEGER,
    "sleepMinutes" INTEGER,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progress_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "progress_entries_childId_entryDate_idx" ON "progress_entries"("childId", "entryDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "progress_entries_childId_entryDate_key" ON "progress_entries"("childId", "entryDate");

-- AddForeignKey
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written range CHECKs (plan 0013 §3 row 1, provisional until D-7). Prisma cannot
-- model these; do NOT drop them. Changing a range is a deliberate follow-up migration.
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_mood_range" CHECK ("mood" BETWEEN 1 AND 5);
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_behaviour_range" CHECK ("behaviour" BETWEEN 1 AND 5);
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_sleep_minutes_range" CHECK ("sleepMinutes" BETWEEN 0 AND 1440);
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_note_length" CHECK (char_length("note") <= 1000);

-- At most one open (not withdrawn, not superseded) consent row per child. Prisma cannot
-- express partial indexes, so this is hand-written (plan 0012 §4).
CREATE UNIQUE INDEX "media_consents_one_open_per_child" ON "media_consents" ("childId") WHERE "withdrawnAt" IS NULL AND "supersededAt" IS NULL;

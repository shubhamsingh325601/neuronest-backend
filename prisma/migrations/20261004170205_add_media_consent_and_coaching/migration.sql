-- CreateTable
CREATE TABLE "media_consents" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "grantedById" UUID NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coaching_tips" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coaching_tips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_consents_childId_grantedAt_idx" ON "media_consents"("childId", "grantedAt");

-- CreateIndex
CREATE INDEX "coaching_tips_childId_weekNumber_idx" ON "coaching_tips"("childId", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "coaching_tips_planId_weekNumber_position_key" ON "coaching_tips"("planId", "weekNumber", "position");

-- AddForeignKey
ALTER TABLE "media_consents" ADD CONSTRAINT "media_consents_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_consents" ADD CONSTRAINT "media_consents_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_tips" ADD CONSTRAINT "coaching_tips_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_tips" ADD CONSTRAINT "coaching_tips_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_tips" ADD CONSTRAINT "coaching_tips_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

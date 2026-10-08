-- CreateTable
CREATE TABLE "plan_weeks" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "focus" TEXT NOT NULL,
    "guidance" JSONB,

    CONSTRAINT "plan_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_goals" (
    "id" UUID NOT NULL,
    "weekId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "icon" TEXT,

    CONSTRAINT "plan_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_activities" (
    "id" UUID NOT NULL,
    "weekId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "goalCategory" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "parentScript" JSONB,
    "equipment" JSONB NOT NULL,
    "clinicalReassurance" TEXT,

    CONSTRAINT "plan_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_completions" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "completedById" UUID NOT NULL,
    "note" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_weeks_planId_weekNumber_key" ON "plan_weeks"("planId", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "plan_goals_weekId_position_key" ON "plan_goals"("weekId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "plan_activities_weekId_position_key" ON "plan_activities"("weekId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "activity_completions_activityId_key" ON "activity_completions"("activityId");

-- CreateIndex
CREATE INDEX "activity_completions_childId_idx" ON "activity_completions"("childId");

-- AddForeignKey
ALTER TABLE "plan_weeks" ADD CONSTRAINT "plan_weeks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_goals" ADD CONSTRAINT "plan_goals_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "plan_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_activities" ADD CONSTRAINT "plan_activities_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "plan_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_completions" ADD CONSTRAINT "activity_completions_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "plan_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_completions" ADD CONSTRAINT "activity_completions_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_completions" ADD CONSTRAINT "activity_completions_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

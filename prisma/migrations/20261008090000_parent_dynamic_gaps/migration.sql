-- AlterTable
ALTER TABLE "appointment_slots" ADD COLUMN "meetingUrl" TEXT;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "prepTopicIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "prepChecklistIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "summary" TEXT,
ADD COLUMN "actionPoints" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "coaching_tips" ADD COLUMN "whyItMatters" TEXT,
ADD COLUMN "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "scriptQuote" TEXT,
ADD COLUMN "scriptContext" TEXT;

-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" UUID NOT NULL,
    "coachingInApp" BOOLEAN NOT NULL DEFAULT true,
    "coachingEmail" BOOLEAN NOT NULL DEFAULT false,
    "coachingWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "appointmentReminders" BOOLEAN NOT NULL DEFAULT true,
    "consultationArchive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AlterTable
ALTER TABLE "children" ADD COLUMN     "accommodations" TEXT,
ADD COLUMN     "clinicalProfile" JSONB,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "preferredName" TEXT,
ADD COLUMN     "primaryLanguage" TEXT;

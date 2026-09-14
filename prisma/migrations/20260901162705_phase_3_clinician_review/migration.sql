-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'INVITED';

-- AlterEnum
ALTER TYPE "VerificationTokenType" ADD VALUE 'ACCOUNT_SETUP';

-- AlterTable
ALTER TABLE "clinician_applications" ADD COLUMN     "reviewNote" TEXT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

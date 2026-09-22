-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaProvider" AS ENUM ('CLOUDINARY');

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "type" "MediaType" NOT NULL,
    "provider" "MediaProvider" NOT NULL DEFAULT 'CLOUDINARY',
    "storageKey" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "mimeType" TEXT,
    "durationSeconds" INTEGER,
    "sizeBytes" INTEGER,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_childId_idx" ON "media"("childId");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

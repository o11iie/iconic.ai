-- CreateEnum
CREATE TYPE "JourneyKind" AS ENUM ('WATCH', 'PLAY');

-- CreateTable
CREATE TABLE "SavedJourney" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "JourneyKind" NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "stepTitleIds" TEXT[],
    "targetTitleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedJourney_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedJourney_userId_idx" ON "SavedJourney"("userId");

-- AddForeignKey
ALTER TABLE "SavedJourney" ADD CONSTRAINT "SavedJourney_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

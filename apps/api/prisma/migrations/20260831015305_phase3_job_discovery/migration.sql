-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "dedupeKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "job_match_previews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_match_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dismissed_jobs" (
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dismissed_jobs_pkey" PRIMARY KEY ("userId","jobId")
);

-- CreateIndex
CREATE INDEX "job_match_previews_userId_matchScore_idx" ON "job_match_previews"("userId", "matchScore");

-- CreateIndex
CREATE UNIQUE INDEX "job_match_previews_userId_jobId_key" ON "job_match_previews"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupeKey_key" ON "jobs"("dedupeKey");

-- AddForeignKey
ALTER TABLE "job_match_previews" ADD CONSTRAINT "job_match_previews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_match_previews" ADD CONSTRAINT "job_match_previews_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dismissed_jobs" ADD CONSTRAINT "dismissed_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dismissed_jobs" ADD CONSTRAINT "dismissed_jobs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


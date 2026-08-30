-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceUrl" TEXT,
    "title" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyInfo" JSONB,
    "rawJd" TEXT NOT NULL,
    "parsedJd" JSONB,
    "location" TEXT,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "salaryRange" TEXT,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "matchReasons" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'gap_reported',
    "gapReport" JSONB,
    "resumeSelection" JSONB,
    "resumeSource" TEXT,
    "renderedWith" TEXT,
    "resumePdfPath" TEXT,
    "emailDraft" JSONB,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "applications_userId_idx" ON "applications"("userId");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

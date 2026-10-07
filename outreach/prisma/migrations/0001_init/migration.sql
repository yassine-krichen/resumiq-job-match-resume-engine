-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ingested', 'dossier_ready', 'awaiting_review', 'needs_manual', 'dropped', 'failed', 'approved', 'scheduled', 'sent', 'replied', 'bounced', 'killed');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('awaiting_review', 'approved', 'killed', 'superseded');

-- CreateEnum
CREATE TYPE "ResumeKind" AS ENUM ('tailored', 'track');

-- CreateEnum
CREATE TYPE "Track" AS ENUM ('ai', 'swe', 'fullstack');

-- CreateEnum
CREATE TYPE "MxStatus" AS ENUM ('ok', 'none', 'unknown', 'unchecked');

-- CreateEnum
CREATE TYPE "EmailSource" AS ENUM ('page_quote', 'pattern_guess', 'hunter');

-- CreateEnum
CREATE TYPE "ContactConfidence" AS ENUM ('normal', 'low');

-- CreateEnum
CREATE TYPE "SendKind" AS ENUM ('initial', 'follow_up');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('scheduled', 'sending', 'sent', 'failed', 'cancelled', 'unknown');

-- CreateEnum
CREATE TYPE "SuppressionKind" AS ENUM ('email', 'domain');

-- CreateTable
CREATE TABLE "OutreachCompany" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "domainKey" TEXT NOT NULL,
    "website" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ingested',
    "statusReason" TEXT,
    "draftAttempts" INTEGER NOT NULL DEFAULT 0,
    "track" "Track",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "roleAccount" BOOLEAN NOT NULL DEFAULT false,
    "mxStatus" "MxStatus" NOT NULL DEFAULT 'unchecked',
    "emailSource" "EmailSource",
    "contactConfidence" "ContactConfidence",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDossier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "rejectedClaims" JSONB NOT NULL DEFAULT '[]',
    "verifiedClaimCount" INTEGER NOT NULL,
    "country" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "fitScore" INTEGER NOT NULL,
    "track" "Track" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachDossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'awaiting_review',
    "generic" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "followUpBody" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "hookClaimId" TEXT,
    "followUpClaimId" TEXT,
    "anchorPhrase" TEXT,
    "mentionedProjects" TEXT[],
    "tailoring" JSONB,
    "resumeKind" "ResumeKind" NOT NULL,
    "track" "Track",
    "resumePdfPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachSend" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "kind" "SendKind" NOT NULL,
    "status" "SendStatus" NOT NULL DEFAULT 'scheduled',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "providerThreadId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachSuppression" (
    "id" TEXT NOT NULL,
    "kind" "SuppressionKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachLease" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachLease_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutreachCompany_slug_key" ON "OutreachCompany"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachCompany_domainKey_key" ON "OutreachCompany"("domainKey");

-- CreateIndex
CREATE INDEX "OutreachCompany_runId_status_idx" ON "OutreachCompany"("runId", "status");

-- CreateIndex
CREATE INDEX "OutreachContact_companyId_idx" ON "OutreachContact"("companyId");

-- CreateIndex
CREATE INDEX "OutreachContact_email_idx" ON "OutreachContact"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDossier_companyId_version_key" ON "OutreachDossier"("companyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDraft_companyId_version_key" ON "OutreachDraft"("companyId", "version");

-- CreateIndex
CREATE INDEX "OutreachSend_status_scheduledAt_idx" ON "OutreachSend"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachSend_draftId_kind_key" ON "OutreachSend"("draftId", "kind");

-- CreateIndex
CREATE INDEX "OutreachEvent_companyId_createdAt_idx" ON "OutreachEvent"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachSuppression_kind_value_key" ON "OutreachSuppression"("kind", "value");

-- AddForeignKey
ALTER TABLE "OutreachContact" ADD CONSTRAINT "OutreachContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "OutreachCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDossier" ADD CONSTRAINT "OutreachDossier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "OutreachCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "OutreachCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachSend" ADD CONSTRAINT "OutreachSend_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OutreachDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "OutreachCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;


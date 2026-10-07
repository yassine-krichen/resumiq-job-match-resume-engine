-- Hand-written rollback for 0001_init. Prisma Migrate has no automatic down
-- migration; run this manually (psql) against the same OUTREACH_DATABASE_URL
-- connection, with search_path set to the `outreach` schema, e.g.
--   SET search_path TO outreach;
-- After running it, remove the 0001_init row from outreach._prisma_migrations
-- so `prisma migrate deploy` re-applies it cleanly.

DROP TABLE IF EXISTS "OutreachLease";
DROP TABLE IF EXISTS "OutreachSend";
DROP TABLE IF EXISTS "OutreachEvent";
DROP TABLE IF EXISTS "OutreachSuppression";
DROP TABLE IF EXISTS "OutreachDraft";
DROP TABLE IF EXISTS "OutreachDossier";
DROP TABLE IF EXISTS "OutreachContact";
DROP TABLE IF EXISTS "OutreachCompany";

DROP TYPE IF EXISTS "SuppressionKind";
DROP TYPE IF EXISTS "SendStatus";
DROP TYPE IF EXISTS "SendKind";
DROP TYPE IF EXISTS "ContactConfidence";
DROP TYPE IF EXISTS "EmailSource";
DROP TYPE IF EXISTS "MxStatus";
DROP TYPE IF EXISTS "Track";
DROP TYPE IF EXISTS "ResumeKind";
DROP TYPE IF EXISTS "DraftStatus";
DROP TYPE IF EXISTS "CompanyStatus";

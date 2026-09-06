// This script runs standalone (invoked directly via ts-node, not the app's
// normal Nest bootstrap), so it must load `.env` itself — nothing else does
// that for it.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { scanTrackedCompanies } from '@resumiq/job-scanner';
import { HunterClient } from '../src/modules/jobs/enrichment/hunter.client';
import { PeopleDataLabsClient } from '../src/modules/jobs/enrichment/people-data-labs.client';
import { ingestScrapedJobs } from '../src/modules/jobs/ingest-scraped-jobs';

const prisma = new PrismaClient();

// Deliberately does NOT bootstrap AppModule/NestFactory/any Nest DI
// container — doing so would spin up JobScraperProcessor's live BullMQ
// Worker as a side effect of module init, which requires Redis and defeats
// the entire point of this script (a scan runnable with zero queue infra).
async function scanAndIngest(): Promise<{ scanned: number; created: number }> {
  const scraped = await scanTrackedCompanies();
  return ingestScrapedJobs(scraped, {
    prisma,
    hunterClient: new HunterClient(),
    pdlClient: new PeopleDataLabsClient(),
  });
}

scanAndIngest()
  .then((result) => {
    console.log(`Scan complete: scanned ${result.scanned}, created ${result.created}.`);
  })
  .catch((error) => {
    console.error('Scan failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().catch((error) => console.error('Disconnect failed:', error)));

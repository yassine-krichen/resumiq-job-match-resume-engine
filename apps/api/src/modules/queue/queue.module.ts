import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

export const JOB_SCRAPER_QUEUE = 'job-scraper';
export const MATCH_PREVIEW_QUEUE = 'match-preview';
export const RESUME_GEN_QUEUE = 'resume-gen';

/**
 * BullMQ setup, backed by Upstash Redis (or any Redis reachable at
 * REDIS_URL). Wires the three Phase 3 queues: daily job scraping, per-user
 * match-preview refresh, and background resume+email generation on swipe-right.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        // validateEnv() (apps/api/src/config/env.schema.ts) already fails
        // boot with an actionable message if REDIS_URL is unset — this is a
        // defensive re-check for any code path that constructs QueueModule
        // without going through main.ts's bootstrap (e.g. a future test
        // harness), so a queue never silently connects to `undefined`.
        const url = process.env.REDIS_URL;
        if (!url) {
          throw new Error(
            'REDIS_URL is not set — QueueModule cannot start. Provision an Upstash Redis ' +
              'database (or any Redis instance) and set REDIS_URL before starting the API.',
          );
        }
        return {
          connection: {
            // Parsed from the URL string rather than passed as a single
            // `url` field — ioredis's RedisOptions type has no `url` key;
            // the connection string is spread into host/port/password/tls
            // via the constructor form BullMQ expects here.
            ...parseRedisUrl(url),
            // BullMQ's hard requirement for serverless/managed Redis
            // (Upstash): the client must never internally retry-then-fail a
            // blocking command, since BullMQ's own retry/backoff logic
            // needs to observe the failure. Do not "fix" this to a finite
            // number — see https://docs.bullmq.io/bull/patterns/persistent-connections
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: JOB_SCRAPER_QUEUE }, { name: MATCH_PREVIEW_QUEUE }, { name: RESUME_GEN_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}

/**
 * Minimal `redis://` / `rediss://` URL parser feeding ioredis's connection
 * options. `rediss://` (double-s) turns on TLS — Upstash's TCP endpoint
 * always uses it — which ioredis's own URL-string constructor form handles
 * natively, but @nestjs/bullmq's `connection` option here is typed as
 * `RedisOptions`, not a connection string, so the scheme has to be resolved
 * to `tls: {}` by hand.
 */
function parseRedisUrl(redisUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
} {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
  };
}

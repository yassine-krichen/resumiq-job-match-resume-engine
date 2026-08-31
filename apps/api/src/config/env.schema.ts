import { z } from 'zod';

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    // Upstash Redis connection string (TCP/TLS endpoint, not the REST API) —
    // backs the BullMQ queues in QueueModule (job-scraper, match-preview,
    // resume-gen). Required at boot, same fail-fast convention as
    // DATABASE_URL, rather than letting QueueModule hang or fail silently
    // the first time a queue is actually used.
    REDIS_URL: z.string().min(1),
    API_URL: z.string().min(1),
    TRUSTED_ORIGINS: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    LINKEDIN_CLIENT_ID: z.string().min(1),
    LINKEDIN_CLIENT_SECRET: z.string().min(1),
    USE_LLM_BRIDGE: z.string().optional().default('false'),
    FREELLMAPI_API_KEY: z.string().optional(),
    FREELLMAPI_MODEL: z.string().optional(),
    BRIDGE_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.USE_LLM_BRIDGE !== 'true') {
      if (!env.FREELLMAPI_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FREELLMAPI_API_KEY'],
          message: 'FREELLMAPI_API_KEY is required when USE_LLM_BRIDGE is not "true"',
        });
      }
      if (!env.FREELLMAPI_MODEL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FREELLMAPI_MODEL'],
          message: 'FREELLMAPI_MODEL is required when USE_LLM_BRIDGE is not "true"',
        });
      }
    } else if (!env.BRIDGE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BRIDGE_URL'],
        message: 'BRIDGE_URL is required when USE_LLM_BRIDGE is "true"',
      });
    }
  });

/**
 * Validates required environment variables at boot time.
 * Runs before Nest's Logger is available — console.error + process.exit(1)
 * is intentional here (boot-time-only, not production runtime logging).
 */
export function validateEnv(): void {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
}

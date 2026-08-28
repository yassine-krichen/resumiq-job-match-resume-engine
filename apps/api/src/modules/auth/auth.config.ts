import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';

// Constructing via a dedicated (non-generic) function, rather than typing
// the cache variable as `ReturnType<typeof betterAuth>` directly, lets
// TypeScript infer the specific instantiated type from the literal config
// below instead of widening to betterAuth's generic default — the widened
// form isn't assignable back from the specific instantiation.
function createAuth() {
  const prisma = new PrismaClient();

  return betterAuth({
    baseURL: process.env.API_URL ?? 'http://localhost:3001',
    basePath: '/api/auth',
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
      linkedin: {
        clientId: process.env.LINKEDIN_CLIENT_ID!,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET!,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24,      // refresh if 1 day old
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,             // 5 min client-side cache
      },
    },
    trustedOrigins: process.env.TRUSTED_ORIGINS!.split(','),
  });
}

type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | undefined;

/**
 * Lazily constructs and caches the better-auth instance.
 *
 * Must not be called at module load time — it reads OAuth/DB env vars via
 * non-null assertion. Construction is deferred to first call (request time,
 * or explicitly in main.ts's bootstrap) so validateEnv() always runs first
 * and fails loudly instead of throwing an unclear error deep inside here.
 */
export function getAuth(): Auth {
  if (!authInstance) {
    authInstance = createAuth();
  }

  return authInstance;
}

export type AuthSession = Auth['$Infer']['Session'];
export type AuthUser = Auth['$Infer']['Session']['user'];

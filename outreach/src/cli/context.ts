import { join } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { loadAppConfig } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { databaseSchemaOf, loadDatabaseUrl, loadRuntimeEnv } from '../config/env';
import type { RuntimeEnv } from '../config/env';
import { outreachPaths } from '../config/paths';
import type { OutreachPaths } from '../config/paths';
import type { OutreachStore } from '../db/outreach-store';
import { LatexRenderer } from '../resume/latex-renderer';
import { loadDataInventory } from '../resume/load-inventory';
import type { MasterDB } from '../resume/master-db';

// Composition root: each command asks only for what it needs, so a missing
// database url does not stop `track-resumes` and a missing config does not
// stop `snapshot`. Everything it does load is validated here, at startup.

export interface Context {
  paths: OutreachPaths;
  env: RuntimeEnv;
}

export function createContext(): Context {
  const paths = outreachPaths();
  loadDotenv({ path: join(paths.root, '.env'), quiet: true });
  return { paths, env: loadRuntimeEnv() };
}

export function loadConfigAndInventory(context: Context): { config: AppConfig; db: MasterDB } {
  const config = loadAppConfig(context.env.configPath, context.paths.root);
  return { config, db: loadDataInventory(config.dataInventoryPath) };
}

export function createRenderer(context: Context): LatexRenderer {
  return new LatexRenderer(context.env.tectonicPath);
}

export interface OpenStore {
  store: OutreachStore;
  close: () => Promise<void>;
}

/** Opens the database lazily: the generated Prisma client is only imported by commands that need it. */
export async function openStore(): Promise<OpenStore> {
  const databaseUrl = loadDatabaseUrl();
  const { createPrismaClient, PrismaOutreachStore } = await import('../db/prisma-store');
  const client = createPrismaClient(databaseUrl);
  return { store: new PrismaOutreachStore(client, databaseSchemaOf(databaseUrl)), close: () => client.$disconnect() };
}

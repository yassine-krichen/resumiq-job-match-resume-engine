import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { toNodeHandler } from 'better-auth/node';
import { validateEnv } from './config/env.schema';
import { getAuth } from './modules/auth/auth.config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import express from 'express';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  // Must run before getAuth() is ever called — betterAuth() reads OAuth/DB
  // env vars via non-null assertion and would throw an unclear error
  // otherwise. auth.config.ts only constructs betterAuth() lazily on first
  // getAuth() call, so importing it here has no side effects.
  validateEnv();

  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Disable so better-auth handles /api/auth body parsing itself
  });

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS must be registered before the raw /api/auth mount below. Express
  // middleware/routes run in registration order, and the /api/auth mount
  // bypasses Nest's pipeline entirely — so if enableCors() were registered
  // after it, requests to /api/auth/* (e.g. sign-in/social) would never
  // pass through CORS. Do not move this back below the auth mount.
  app.enableCors({
    origin: process.env.TRUSTED_ORIGINS!.split(','),
    credentials: true,
  });

  // Mount better-auth before any body parser — it handles its own parsing.
  // Note: these routes bypass Nest's pipeline entirely (mounted directly on
  // the underlying express server), so ThrottlerGuard cannot reach them.
  // Rate limiting for this mount is instead handled by better-auth's own
  // built-in `rateLimit` config, set inside createAuth() in auth.config.ts.
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.use('/api/auth', toNodeHandler(getAuth()));

  // Re-enable body parsing for all other routes
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

bootstrap();

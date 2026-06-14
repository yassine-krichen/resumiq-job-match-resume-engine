import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './modules/auth/auth.config';
import express from 'express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Disable so better-auth handles /api/auth body parsing itself
  });

  app.setGlobalPrefix('api');

  // Mount better-auth before any body parser — it handles its own parsing
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.use('/api/auth', toNodeHandler(auth));

  // Re-enable body parsing for all other routes
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.enableCors({
    origin: (process.env.TRUSTED_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();

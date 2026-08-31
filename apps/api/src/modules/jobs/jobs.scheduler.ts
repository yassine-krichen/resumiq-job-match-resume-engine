import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JOB_SCRAPER_QUEUE } from '../queue/queue.module';

/**
 * Daily trigger only — the actual scan work happens in
 * JobScraperProcessor, so retries/backoff on failure are BullMQ-native
 * rather than reimplemented here.
 */
@Injectable()
export class JobsScheduler {
  constructor(@InjectQueue(JOB_SCRAPER_QUEUE) private readonly jobScraperQueue: Queue) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async triggerDailyScan(): Promise<void> {
    await this.jobScraperQueue.add('scan', {});
  }
}

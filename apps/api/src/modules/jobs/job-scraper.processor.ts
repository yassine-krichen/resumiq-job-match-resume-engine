import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOB_SCRAPER_QUEUE } from '../queue/queue.module';
import { JobsService } from './jobs.service';

@Processor(JOB_SCRAPER_QUEUE)
export class JobScraperProcessor extends WorkerHost {
  private readonly logger = new Logger(JobScraperProcessor.name);

  constructor(private readonly jobsService: JobsService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const result = await this.jobsService.ingestFromScanner();
    this.logger.log(`job-scraper run ${job.id}: scanned ${result.scanned}, created ${result.created}`);
  }
}

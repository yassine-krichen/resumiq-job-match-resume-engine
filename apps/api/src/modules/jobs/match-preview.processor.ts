import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MATCH_PREVIEW_QUEUE } from '../queue/queue.module';
import { JobsService } from './jobs.service';

interface MatchPreviewJobData {
  userId: string;
}

@Processor(MATCH_PREVIEW_QUEUE)
export class MatchPreviewProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchPreviewProcessor.name);

  constructor(private readonly jobsService: JobsService) {
    super();
  }

  async process(job: Job<MatchPreviewJobData>): Promise<void> {
    const result = await this.jobsService.refreshMatchPreviews(job.data.userId);
    this.logger.log(`match-preview run ${job.id} for user ${job.data.userId}: refreshed ${result.refreshed}`);
  }
}

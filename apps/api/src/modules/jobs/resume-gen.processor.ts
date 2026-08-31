import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { RESUME_GEN_QUEUE } from '../queue/queue.module';
import { ApplicationsService } from '../applications/applications.service';

interface ResumeGenJobData {
  userId: string;
  jobId: string;
}

const noop = (): void => {};

/**
 * Runs the full background apply pipeline on swipe-right: draft (same logic
 * as the manual `/apply/manual` flow, reusing the already-scraped
 * `parsedJd`), and — only when a resume was actually drafted, not a gap
 * report — render + draft the email back-to-back, since nobody is watching
 * a background job to click through review gates. Lands at whatever status
 * `finalizeAndDraftEmail` naturally sets (`email_drafted`) — `confirm()`
 * stays a manual, explicit user action even from this path.
 */
@Processor(RESUME_GEN_QUEUE)
export class ResumeGenProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumeGenProcessor.name);

  constructor(private readonly applicationsService: ApplicationsService) {
    super();
  }

  async process(job: Job<ResumeGenJobData>): Promise<void> {
    const { userId, jobId } = job.data;
    const draftResult = await this.applicationsService.draftForExistingJob(userId, jobId, noop);

    if (!('selection' in draftResult) || !draftResult.selection) {
      this.logger.log(`resume-gen ${job.id}: below match threshold, gap report saved (no resume drafted)`);
      return;
    }

    await this.applicationsService.finalizeAndDraftEmail(userId, draftResult.applicationId, noop);
    this.logger.log(`resume-gen ${job.id}: resume + email drafted for application ${draftResult.applicationId}`);
  }
}

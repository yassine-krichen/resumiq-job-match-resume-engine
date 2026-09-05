import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  DiscoverFeedFiltersSchema,
  UpdateUserSettingsSchema,
  type DiscoverFeedFiltersDto,
  type UpdateUserSettingsDto,
} from '@resumiq/schemas';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JobsService } from './jobs.service';
import { JOB_SCRAPER_QUEUE } from '../queue/queue.module';

@Controller('jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    @InjectQueue(JOB_SCRAPER_QUEUE) private readonly jobScraperQueue: Queue,
  ) {}

  /**
   * Manual trigger for the job scraper, so a user doesn't have to wait for
   * the 3am cron (JobsScheduler) to see the discover feed populated. Enqueues
   * onto the same queue/processor the cron uses — no duplicated scan logic.
   */
  @Post('scan-now')
  @HttpCode(202)
  async scanNow() {
    const job = await this.jobScraperQueue.add('scan', {});
    return { queued: true, jobId: job.id };
  }

  @Get('discover')
  async discover(
    @Req() req: { user: { id: string } },
    @Query(new ZodValidationPipe(DiscoverFeedFiltersSchema)) filters: DiscoverFeedFiltersDto,
  ) {
    return this.jobsService.getDiscoverFeed(req.user.id, filters);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(@Req() req: { user: { id: string } }, @Param('id') id: string) {
    await this.jobsService.dismiss(req.user.id, id);
    return { dismissed: true };
  }

  @Post(':id/swipe-right')
  @HttpCode(200)
  async swipeRight(@Req() req: { user: { id: string } }, @Param('id') id: string) {
    await this.jobsService.swipeRight(req.user.id, id);
    return { queued: true };
  }

  /**
   * Called by the frontend after auth resolves on /discover mount — there's
   * no existing login-hook to attach this to, so the page itself triggers it.
   */
  @Post('refresh-previews')
  @HttpCode(200)
  async refreshPreviews(@Req() req: { user: { id: string } }) {
    return this.jobsService.refreshMatchPreviews(req.user.id);
  }

  @Get('settings')
  async getSettings(@Req() req: { user: { id: string } }) {
    return this.jobsService.getUserSettings(req.user.id);
  }

  @Patch('settings')
  async updateSettings(
    @Req() req: { user: { id: string } },
    @Body(new ZodValidationPipe(UpdateUserSettingsSchema)) patch: UpdateUserSettingsDto,
  ) {
    return this.jobsService.updateUserSettings(req.user.id, patch);
  }
}

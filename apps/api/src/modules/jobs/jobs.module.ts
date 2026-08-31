import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ProfileModule } from '../profile/profile.module';
import { ApplicationsModule } from '../applications/applications.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsScheduler } from './jobs.scheduler';
import { JobScraperProcessor } from './job-scraper.processor';
import { MatchPreviewProcessor } from './match-preview.processor';
import { ResumeGenProcessor } from './resume-gen.processor';
import { HunterClient } from './enrichment/hunter.client';
import { PeopleDataLabsClient } from './enrichment/people-data-labs.client';

@Module({
  imports: [QueueModule, ProfileModule, ApplicationsModule],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobsScheduler,
    JobScraperProcessor,
    MatchPreviewProcessor,
    ResumeGenProcessor,
    HunterClient,
    PeopleDataLabsClient,
  ],
  exports: [JobsService],
})
export class JobsModule {}

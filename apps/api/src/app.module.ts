import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { ResumeModule } from './modules/resume/resume.module';
import { QueueModule } from './modules/queue/queue.module';
import { JobsModule } from './modules/jobs/jobs.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ProfileModule,
    OnboardingModule,
    ResumeModule,
    ApplicationsModule,
    QueueModule,
    JobsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

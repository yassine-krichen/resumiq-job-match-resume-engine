import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { OnboardingService } from './onboarding.service';
import { ProfileService } from '../profile/profile.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { MasterDB } from '@resumiq/ai-bridge';
import { IngestBodySchema, type IngestBodyDto } from '@resumiq/schemas';

@Controller('onboarding')
@UseGuards(AuthGuard)
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly profileService: ProfileService,
  ) {}

  /**
   * POST /api/onboarding/ingest/stream
   * SSE endpoint: streams progress events while the AI parses career text,
   * then merges the result into the user's career profile.
   */
  @Post('ingest/stream')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async ingestStream(
    @Req() req: { user: { id: string } },
    @Res() res: Response,
    @Body(new ZodValidationPipe(IngestBodySchema)) body: IngestBodyDto,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send('progress', { step: 'Starting AI analysis...' });

      const existingProfile = await this.profileService.getProfile(req.user.id);

      const result = await this.onboardingService.parseCareerText(
        body.raw_text,
        existingProfile,
        (step) => send('progress', { step }),
      );

      send('progress', { step: 'Merging into profile...' });

      const section = result.type === 'project' ? 'projects'
        : result.type === 'experience' ? 'experience'
        : result.type === 'education' ? 'education'
        : result.type === 'certification' ? 'certifications'
        : result.type === 'award' ? 'awards_and_honors'
        : 'skills';

      const updatedProfile = await this.profileService.mergeSection(
        req.user.id,
        section as keyof MasterDB,
        result.entry,
      );

      send('done', { profile: updatedProfile, parsed: result });
      res.end();
    } catch (err) {
      send('error', { message: (err as Error).message });
      res.end();
    }
  }
}

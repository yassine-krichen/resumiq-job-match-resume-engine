import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { OnboardingService, IngestUserFacingError } from './onboarding.service';
import { ProfileService } from '../profile/profile.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { MasterDB } from '@resumiq/ai-bridge';
import {
  ConfirmIngestSchema,
  IngestBodySchema,
  type ConfirmIngestDto,
  type IngestBodyDto,
  type IngestEntryDto,
} from '@resumiq/schemas';

/** Generic, client-facing message for any failure that isn't a known `IngestUserFacingError`
 * — never leak internal error details (zod messages, LLM provider errors) to the browser. */
const GENERIC_INGEST_ERROR_MESSAGE =
  'Something went wrong while parsing your text. Please try again.';

const SECTION_BY_TYPE: Record<IngestEntryDto['type'], keyof MasterDB> = {
  experience: 'experience',
  project: 'projects',
  education: 'education',
  certification: 'certifications',
  award: 'awards_and_honors',
  skills: 'skills',
  summary: 'summaries',
  publication: 'publications_and_speaking',
  volunteering: 'volunteering_and_leadership',
  interest: 'interests',
};

@Controller('onboarding')
@UseGuards(AuthGuard)
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly profileService: ProfileService,
  ) {}

  /**
   * POST /api/onboarding/ingest/stream
   * SSE endpoint: streams progress events while the AI parses career text.
   * Parse-only — nothing is written to the profile here. The client reviews
   * the returned entries and persists them via `POST /onboarding/ingest/confirm`.
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

      send('done', {
        parsed: result.entries,
        droppedEntries: result.droppedEntries,
      });
      res.end();
    } catch (err) {
      if (err instanceof IngestUserFacingError) {
        send('error', { message: err.message });
      } else {
        this.logger.error(
          `Unexpected failure during career-text ingest: ${(err as Error).message}`,
          (err as Error).stack,
        );
        send('error', { message: GENERIC_INGEST_ERROR_MESSAGE });
      }
      res.end();
    }
  }

  /**
   * POST /api/onboarding/ingest/confirm
   * Persists the (possibly user-edited) entries a prior parse-only ingest
   * returned. Kept separate from `ingest/stream` so the user reviews what's
   * about to be written before it lands in their profile.
   *
   * mergeSections reads the profile once, applies every entry to an
   * in-memory copy, and writes once — so the whole batch merges atomically.
   * Either all entries land, or (on failure) none do; no partial-commit that
   * a client retry could then duplicate.
   */
  @Post('ingest/confirm')
  @HttpCode(200)
  async confirmIngest(
    @Req() req: { user: { id: string } },
    @Body(new ZodValidationPipe(ConfirmIngestSchema)) body: ConfirmIngestDto,
  ): Promise<MasterDB> {
    return this.profileService.mergeSections(
      req.user.id,
      body.entries.map((entry) => ({
        section: SECTION_BY_TYPE[entry.type],
        entry: entry.entry,
      })),
    );
  }
}

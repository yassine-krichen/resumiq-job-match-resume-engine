import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { ApplicationsService } from './applications.service';
import { LocalStorageService } from '../../common/storage/local-storage.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateJobSchema,
  ListApplicationsFiltersSchema,
  UpdateEmailDraftSchema,
  UpdateGapReportSchema,
  UpdateResumeSelectionSchema,
  type CreateJobDto,
  type ListApplicationsFiltersDto,
  type UpdateEmailDraftDto,
  type UpdateGapReportDto,
  type UpdateResumeSelectionDto,
} from '@resumiq/schemas';

@Controller('applications')
@UseGuards(AuthGuard)
export class ApplicationsController {
  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly storage: LocalStorageService,
  ) {}

  /**
   * POST /api/applications/analyze/stream
   * SSE: analyzes the JD, scores compatibility, and either returns a gap
   * report (below threshold) or a draft resume selection (at/above threshold).
   */
  @Post('analyze/stream')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async analyzeStream(
    @Req() req: { user: { id: string } },
    @Res() res: Response,
    @Body(new ZodValidationPipe(CreateJobSchema)) body: CreateJobDto,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.applicationsService.analyzeAndDraft(req.user.id, body, (step) =>
        send('progress', { step }),
      );
      send('done', result);
      res.end();
    } catch (err) {
      send('error', { message: (err as Error).message });
      res.end();
    }
  }

  @Patch(':id/resume-selection')
  async updateResumeSelection(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateResumeSelectionSchema)) body: UpdateResumeSelectionDto,
  ) {
    return this.applicationsService.updateResumeSelection(req.user.id, id, body);
  }

  @Patch(':id/gap-report')
  async updateGapReport(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateGapReportSchema)) body: UpdateGapReportDto,
  ) {
    return this.applicationsService.updateGapReport(req.user.id, id, body);
  }

  /**
   * POST /api/applications/:id/render-preview
   * Stateless — compiles the given selection and returns PDF bytes + page
   * count without persisting anything. Used for the debounced live preview.
   */
  @Post(':id/render-preview')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async renderPreview(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateResumeSelectionSchema)) body: UpdateResumeSelectionDto,
  ) {
    const result = await this.applicationsService.renderPreview(req.user.id, id, body);
    return { pdf: result.pdf.toString('base64'), pageCount: result.pageCount };
  }

  /**
   * POST /api/applications/:id/finalize/stream
   * SSE: renders the confirmed selection to PDF, persists it, then drafts a
   * cold email off the same job/company context.
   */
  @Post(':id/finalize/stream')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async finalizeStream(
    @Req() req: { user: { id: string } },
    @Res() res: Response,
    @Param('id') id: string,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.applicationsService.finalizeAndDraftEmail(
        req.user.id,
        id,
        (step) => send('progress', { step }),
      );
      send('done', result);
      res.end();
    } catch (err) {
      send('error', { message: (err as Error).message });
      res.end();
    }
  }

  @Patch(':id/email-draft')
  async updateEmailDraft(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEmailDraftSchema)) body: UpdateEmailDraftDto,
  ) {
    return this.applicationsService.updateEmailDraft(req.user.id, id, body);
  }

  @Post(':id/confirm')
  async confirm(@Req() req: { user: { id: string } }, @Param('id') id: string) {
    return this.applicationsService.confirm(req.user.id, id);
  }

  /**
   * GET /api/applications
   * The applications dashboard's filterable, paginated list. Declared before
   * `@Get(':id')` below — NestJS matches routes in declaration order, so a
   * static/query-string route placed after `:id` would never be reached
   * (this one doesn't collide since it has no path segment, but the
   * dashboard-summary route below would if it were declared later).
   */
  @Get()
  async list(
    @Req() req: { user: { id: string } },
    @Query(new ZodValidationPipe(ListApplicationsFiltersSchema)) filters: ListApplicationsFiltersDto,
  ) {
    return this.applicationsService.listApplications(req.user.id, filters);
  }

  /**
   * GET /api/applications/dashboard-summary
   * Must be declared before `@Get(':id')` — otherwise NestJS's `:id` route
   * would greedily match `/applications/dashboard-summary` as if
   * `id === 'dashboard-summary'`.
   */
  @Get('dashboard-summary')
  async dashboardSummary(@Req() req: { user: { id: string } }) {
    return this.applicationsService.getDashboardSummary(req.user.id);
  }

  /**
   * POST /api/applications/:id/regenerate/stream
   * SSE: re-drafts an existing application from scratch, same progress/done/
   * error framing as `finalize/stream`.
   */
  @Post(':id/regenerate/stream')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async regenerateStream(
    @Req() req: { user: { id: string } },
    @Res() res: Response,
    @Param('id') id: string,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.applicationsService.regenerate(req.user.id, id, (step) =>
        send('progress', { step }),
      );
      send('done', result);
      res.end();
    } catch (err) {
      send('error', { message: (err as Error).message });
      res.end();
    }
  }

  @Get(':id')
  async getById(@Req() req: { user: { id: string } }, @Param('id') id: string) {
    return this.applicationsService.getById(req.user.id, id);
  }

  @Get(':id/resume.pdf')
  async getResumePdf(
    @Req() req: { user: { id: string } },
    @Res() res: Response,
    @Param('id') id: string,
  ) {
    const pdfPath = await this.applicationsService.getResumePdfPath(req.user.id, id);
    const bytes = await this.storage.get(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(bytes);
  }
}

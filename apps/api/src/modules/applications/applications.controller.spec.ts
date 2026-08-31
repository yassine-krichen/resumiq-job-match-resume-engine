import { Response } from 'express';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ListApplicationsFiltersSchema,
  InterviewPrepIntakeAnswersSchema,
} from '@resumiq/schemas';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { LocalStorageService } from '../../common/storage/local-storage.service';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

// better-auth (and better-auth/node) are ESM-only and would otherwise fail
// to parse under Jest's default CommonJS transform — stub them since this
// suite only asserts that AuthGuard is wired up via @UseGuards, it never
// exercises the guard's real session logic.
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (headers: unknown) => headers,
}));

jest.mock('../auth/auth.config', () => ({
  getAuth: () => ({ api: { getSession: jest.fn() } }),
}));

function fakeResponse(): Response & {
  writes: string[];
  headers: Record<string, string>;
  ended: boolean;
  sent: unknown;
} {
  const res = {
    writes: [] as string[],
    headers: {} as Record<string, string>,
    ended: false,
    sent: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    flushHeaders: jest.fn(),
    write(chunk: string) {
      this.writes.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
    },
    send(body: unknown) {
      this.sent = body;
    },
  };
  return res as unknown as Response & typeof res;
}

/** Parses `event: X\ndata: Y\n\n` SSE frames the same way an EventSource client would. */
function parseSSEFrames(writes: string[]): Array<{ event: string; data: unknown }> {
  return writes.map((frame) => {
    const [eventLine, dataLine] = frame.trim().split('\n');
    return {
      event: eventLine.replace('event: ', ''),
      data: JSON.parse(dataLine.replace('data: ', '')),
    };
  });
}

describe('ApplicationsController', () => {
  let applicationsService: {
    analyzeAndDraft: jest.Mock;
    updateResumeSelection: jest.Mock;
    updateGapReport: jest.Mock;
    renderPreview: jest.Mock;
    finalizeAndDraftEmail: jest.Mock;
    updateEmailDraft: jest.Mock;
    confirm: jest.Mock;
    getById: jest.Mock;
    getResumePdfPath: jest.Mock;
    listApplications: jest.Mock;
    getDashboardSummary: jest.Mock;
    regenerate: jest.Mock;
    generateInterviewPrepIntake: jest.Mock;
    updateInterviewPrepIntakeAnswers: jest.Mock;
    generateInterviewPrepReport: jest.Mock;
  };
  let storage: { get: jest.Mock };
  let controller: ApplicationsController;
  const req = { user: { id: 'user-1' } };
  const ATTACKER = { user: { id: 'user-attacker' } };

  beforeEach(() => {
    applicationsService = {
      analyzeAndDraft: jest.fn(),
      updateResumeSelection: jest.fn(),
      updateGapReport: jest.fn(),
      renderPreview: jest.fn(),
      finalizeAndDraftEmail: jest.fn(),
      updateEmailDraft: jest.fn(),
      confirm: jest.fn(),
      getById: jest.fn(),
      getResumePdfPath: jest.fn(),
      listApplications: jest.fn(),
      getDashboardSummary: jest.fn(),
      regenerate: jest.fn(),
      generateInterviewPrepIntake: jest.fn(),
      updateInterviewPrepIntakeAnswers: jest.fn(),
      generateInterviewPrepReport: jest.fn(),
    };
    storage = { get: jest.fn() };
    controller = new ApplicationsController(
      applicationsService as unknown as ApplicationsService,
      storage as unknown as LocalStorageService,
    );
  });

  it('is guarded by AuthGuard on every route (class-level @UseGuards)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ApplicationsController);
    expect(guards).toContain(AuthGuard);
  });

  describe('analyzeStream (SSE)', () => {
    it('streams a progress event, then a done event matching the onboarding SSE frame convention', async () => {
      const res = fakeResponse();
      applicationsService.analyzeAndDraft.mockImplementation(async (userId, body, onProgress) => {
        onProgress('Extracting job details...');
        return { applicationId: 'app-1', matchScore: 80, reasons: [] };
      });

      await controller.analyzeStream(req, res, { raw_jd: 'x'.repeat(60), pages: 2 } as never);

      expect(res.headers['Content-Type']).toBe('text/event-stream');
      expect(res.headers['Cache-Control']).toBe('no-cache');
      expect(res.headers['Connection']).toBe('keep-alive');

      const frames = parseSSEFrames(res.writes);
      expect(frames[0]).toEqual({ event: 'progress', data: { step: 'Extracting job details...' } });
      expect(frames[1]).toEqual({
        event: 'done',
        data: { applicationId: 'app-1', matchScore: 80, reasons: [] },
      });
      expect(res.ended).toBe(true);
    });

    it('streams an error event with the failure message and still ends the response', async () => {
      const res = fakeResponse();
      applicationsService.analyzeAndDraft.mockRejectedValue(new Error('Career profile required'));

      await controller.analyzeStream(req, res, { raw_jd: 'x'.repeat(60), pages: 2 } as never);

      const frames = parseSSEFrames(res.writes);
      expect(frames).toEqual([{ event: 'error', data: { message: 'Career profile required' } }]);
      expect(res.ended).toBe(true);
    });

    it('scopes the analyze call to the authenticated session user, never a client-supplied id', async () => {
      const res = fakeResponse();
      applicationsService.analyzeAndDraft.mockResolvedValue({ applicationId: 'app-1' });
      const body = { raw_jd: 'x'.repeat(60), pages: 2 } as never;

      await controller.analyzeStream(req, res, body);

      expect(applicationsService.analyzeAndDraft).toHaveBeenCalledWith(
        'user-1',
        body,
        expect.any(Function),
      );
    });
  });

  describe('finalizeStream (SSE)', () => {
    it('streams progress events then a done event matching the onboarding SSE frame convention', async () => {
      const res = fakeResponse();
      applicationsService.finalizeAndDraftEmail.mockImplementation(async (userId, id, onProgress) => {
        onProgress('Rendering PDF...');
        onProgress("Drafting cold email in company's tone & values...");
        return { applicationId: 'app-1', pdfPath: 'user-1/app-1/resume.pdf', emailDraft: { subject: 's', body: 'b' } };
      });

      await controller.finalizeStream(req, res, 'app-1');

      const frames = parseSSEFrames(res.writes);
      expect(frames[0].event).toBe('progress');
      expect(frames[1].event).toBe('progress');
      expect(frames[2]).toEqual({
        event: 'done',
        data: { applicationId: 'app-1', pdfPath: 'user-1/app-1/resume.pdf', emailDraft: { subject: 's', body: 'b' } },
      });
      expect(res.ended).toBe(true);
    });

    it('streams an error event when finalizing fails for an application owned by someone else', async () => {
      const res = fakeResponse();
      applicationsService.finalizeAndDraftEmail.mockRejectedValue(new Error('Application not found'));

      await controller.finalizeStream(req, res, 'someone-elses-app');

      const frames = parseSSEFrames(res.writes);
      expect(frames).toEqual([{ event: 'error', data: { message: 'Application not found' } }]);
      expect(res.ended).toBe(true);
    });
  });

  describe('delegation to the session user (never a client-supplied userId)', () => {
    it('updateResumeSelection passes the session userId, route id, and body through', async () => {
      applicationsService.updateResumeSelection.mockResolvedValue({ id: 'app-1' });
      const body = { reasoning: 'r' } as never;

      await controller.updateResumeSelection(req, 'app-1', body);

      expect(applicationsService.updateResumeSelection).toHaveBeenCalledWith('user-1', 'app-1', body);
    });

    it('updateGapReport passes the session userId, route id, and body through', async () => {
      applicationsService.updateGapReport.mockResolvedValue({ id: 'app-1' });
      const body = { match_score: 10, missing_skills: [], strengths: [], recommendations: [] };

      await controller.updateGapReport(req, 'app-1', body);

      expect(applicationsService.updateGapReport).toHaveBeenCalledWith('user-1', 'app-1', body);
    });

    it('updateEmailDraft passes the session userId, route id, and body through', async () => {
      applicationsService.updateEmailDraft.mockResolvedValue({ id: 'app-1' });
      const body = { subject: 's', body: 'b' };

      await controller.updateEmailDraft(req, 'app-1', body);

      expect(applicationsService.updateEmailDraft).toHaveBeenCalledWith('user-1', 'app-1', body);
    });

    it('confirm passes the session userId and route id through', async () => {
      applicationsService.confirm.mockResolvedValue({ id: 'app-1', status: 'email_drafted' });

      await controller.confirm(req, 'app-1');

      expect(applicationsService.confirm).toHaveBeenCalledWith('user-1', 'app-1');
    });

    it('getById passes the session userId and route id through', async () => {
      applicationsService.getById.mockResolvedValue({ id: 'app-1' });

      await controller.getById(req, 'app-1');

      expect(applicationsService.getById).toHaveBeenCalledWith('user-1', 'app-1');
    });
  });

  describe('renderPreview', () => {
    it('base64-encodes the rendered PDF bytes in the JSON response', async () => {
      applicationsService.renderPreview.mockResolvedValue({
        pdf: Buffer.from('pdf-bytes'),
        pageCount: 1,
      });

      const result = await controller.renderPreview(req, 'app-1', {} as never);

      expect(result).toEqual({ pdf: Buffer.from('pdf-bytes').toString('base64'), pageCount: 1 });
    });
  });

  describe('getResumePdf', () => {
    it('fetches the stored PDF via the ownership-checked path and streams it back as application/pdf', async () => {
      applicationsService.getResumePdfPath.mockResolvedValue('user-1/app-1/resume.pdf');
      storage.get.mockResolvedValue(Buffer.from('%PDF-1.4'));
      const res = fakeResponse();

      await controller.getResumePdf(req, res, 'app-1');

      expect(applicationsService.getResumePdfPath).toHaveBeenCalledWith('user-1', 'app-1');
      expect(storage.get).toHaveBeenCalledWith('user-1/app-1/resume.pdf');
      expect(res.headers['Content-Type']).toBe('application/pdf');
      expect(res.sent).toEqual(Buffer.from('%PDF-1.4'));
    });
  });

  describe('list', () => {
    it('scopes the list query to the authenticated session user, never a client-supplied id', async () => {
      const filters = { page: 1, page_size: 20 } as never;
      applicationsService.listApplications.mockResolvedValue({
        total: 0,
        page: 1,
        pageSize: 20,
        items: [],
      });

      await controller.list(req, filters);

      expect(applicationsService.listApplications).toHaveBeenCalledWith('user-1', filters);
    });

    it('returns the paginated result from listApplications unchanged', async () => {
      const result = { total: 2, page: 1, pageSize: 20, items: [{ id: 'app-1' }, { id: 'app-2' }] };
      applicationsService.listApplications.mockResolvedValue(result);

      const response = await controller.list(req, { page: 1, page_size: 20 } as never);

      expect(response).toEqual(result);
    });

    it('does not fall through to getById — a client hitting GET /applications with no id resolves to the list handler', async () => {
      applicationsService.listApplications.mockResolvedValue({
        total: 0,
        page: 1,
        pageSize: 20,
        items: [],
      });

      await controller.list(req, { page: 1, page_size: 20 } as never);

      expect(applicationsService.getById).not.toHaveBeenCalled();
    });
  });

  describe('ListApplicationsFiltersSchema (as wired via ZodValidationPipe on GET /applications)', () => {
    it('coerces query-string page, page_size, and match_score bounds to numbers', () => {
      const pipe = new ZodValidationPipe(ListApplicationsFiltersSchema);

      const parsed = pipe.transform({
        page: '2',
        page_size: '10',
        match_score_min: '50',
        match_score_max: '90',
        status: 'ready',
        company: 'Acme',
      });

      expect(parsed).toEqual({
        page: 2,
        page_size: 10,
        match_score_min: 50,
        match_score_max: 90,
        status: 'ready',
        company: 'Acme',
      });
    });

    it('defaults page to 1 and page_size to 20 when omitted', () => {
      const pipe = new ZodValidationPipe(ListApplicationsFiltersSchema);

      expect(pipe.transform({})).toEqual({ page: 1, page_size: 20 });
    });

    it('rejects a page_size above its max of 50', () => {
      const pipe = new ZodValidationPipe(ListApplicationsFiltersSchema);

      expect(() => pipe.transform({ page_size: '500' })).toThrow();
    });

    it('rejects a match_score_min above its max of 100', () => {
      const pipe = new ZodValidationPipe(ListApplicationsFiltersSchema);

      expect(() => pipe.transform({ match_score_min: '150' })).toThrow();
    });

    it('rejects a status value outside the four filterable statuses', () => {
      const pipe = new ZodValidationPipe(ListApplicationsFiltersSchema);

      expect(() => pipe.transform({ status: 'archived' })).toThrow();
    });
  });

  describe('dashboardSummary', () => {
    it('scopes the dashboard summary lookup to the authenticated session user, never a client-supplied id', async () => {
      const summary = {
        totalApplications: 5,
        avgMatchScore: 72,
        resumesGenerated: 2,
        gapReportsSaved: 3,
        recentActivity: [],
        savedGapReports: [],
      };
      applicationsService.getDashboardSummary.mockResolvedValue(summary);

      const response = await controller.dashboardSummary(req);

      expect(applicationsService.getDashboardSummary).toHaveBeenCalledWith('user-1');
      expect(response).toEqual(summary);
    });
  });

  describe('regenerateStream (SSE)', () => {
    it('streams progress events then a done event matching the finalize/stream SSE frame convention', async () => {
      const res = fakeResponse();
      applicationsService.regenerate.mockImplementation(async (userId, id, onProgress) => {
        onProgress('Comparing against your Career Inventory...');
        onProgress('Selecting best content from your Inventory for this role...');
        return { applicationId: 'app-1', matchScore: 85, reasons: [], selection: {} };
      });

      await controller.regenerateStream(req, res, 'app-1');

      expect(res.headers['Content-Type']).toBe('text/event-stream');
      const frames = parseSSEFrames(res.writes);
      expect(frames[0].event).toBe('progress');
      expect(frames[1].event).toBe('progress');
      expect(frames[2]).toEqual({
        event: 'done',
        data: { applicationId: 'app-1', matchScore: 85, reasons: [], selection: {} },
      });
      expect(res.ended).toBe(true);
    });

    it('streams an error event (not an uncaught exception) when regenerating an application owned by someone else', async () => {
      const res = fakeResponse();
      applicationsService.regenerate.mockRejectedValue(new Error('Application not found'));

      await controller.regenerateStream(ATTACKER, res, 'someone-elses-app');

      const frames = parseSSEFrames(res.writes);
      expect(frames).toEqual([{ event: 'error', data: { message: 'Application not found' } }]);
      expect(res.ended).toBe(true);
    });

    it('streams an error event (not an uncaught exception) when the underlying job has no parsed JD yet', async () => {
      const res = fakeResponse();
      applicationsService.regenerate.mockRejectedValue(
        new Error('This job has not been analyzed yet — no parsed job description available'),
      );

      await controller.regenerateStream(req, res, 'app-1');

      const frames = parseSSEFrames(res.writes);
      expect(frames).toEqual([
        {
          event: 'error',
          data: { message: 'This job has not been analyzed yet — no parsed job description available' },
        },
      ]);
      expect(res.ended).toBe(true);
    });

    it('scopes the regenerate call to the authenticated session user and route id, never a client-supplied userId', async () => {
      const res = fakeResponse();
      applicationsService.regenerate.mockResolvedValue({ applicationId: 'app-1' });

      await controller.regenerateStream(req, res, 'app-1');

      expect(applicationsService.regenerate).toHaveBeenCalledWith(
        'user-1',
        'app-1',
        expect.any(Function),
      );
    });
  });

  describe('generateInterviewPrepIntake', () => {
    it('scopes the intake generation to the authenticated session user, never a client-supplied id', async () => {
      applicationsService.generateInterviewPrepIntake.mockResolvedValue({
        weak_topics: [],
        dynamic_questions: [],
      });

      await controller.generateInterviewPrepIntake(req, 'app-1');

      expect(applicationsService.generateInterviewPrepIntake).toHaveBeenCalledWith('user-1', 'app-1');
    });

    it('does not leak an attacker-supplied userId — the attacker session still resolves against their own id', async () => {
      applicationsService.generateInterviewPrepIntake.mockResolvedValue({
        weak_topics: [],
        dynamic_questions: [],
      });

      await controller.generateInterviewPrepIntake(ATTACKER, 'someone-elses-app');

      expect(applicationsService.generateInterviewPrepIntake).toHaveBeenCalledWith(
        'user-attacker',
        'someone-elses-app',
      );
    });

    it('returns the intake result from the service unchanged', async () => {
      const intake = { weak_topics: ['System Design'], dynamic_questions: ['Why this role?'] };
      applicationsService.generateInterviewPrepIntake.mockResolvedValue(intake);

      const response = await controller.generateInterviewPrepIntake(req, 'app-1');

      expect(response).toEqual(intake);
    });
  });

  describe('updateInterviewPrepIntakeAnswers', () => {
    it('passes the session userId, route id, and parsed body through to the service', async () => {
      applicationsService.updateInterviewPrepIntakeAnswers.mockResolvedValue({ id: 'app-1' });
      const body = {
        interview_format: 'panel',
        weak_topics_selected: ['System Design'],
        dynamic_question_answers: [{ question: 'Why this role?', answer: 'Because...' }],
      } as never;

      await controller.updateInterviewPrepIntakeAnswers(req, 'app-1', body);

      expect(applicationsService.updateInterviewPrepIntakeAnswers).toHaveBeenCalledWith(
        'user-1',
        'app-1',
        body,
      );
    });
  });

  describe('InterviewPrepIntakeAnswersSchema (as wired via ZodValidationPipe on PATCH :id/interview-prep/intake)', () => {
    it('accepts a fully valid intake-answers payload', () => {
      const pipe = new ZodValidationPipe(InterviewPrepIntakeAnswersSchema);

      const parsed = pipe.transform({
        interview_format: 'one_on_one',
        interviewers: 'Jane, eng manager',
        concerns: 'Limited system-design experience',
        weak_topics_selected: ['System Design'],
        dynamic_question_answers: [{ question: 'Why this role?', answer: 'Because...' }],
      });

      expect(parsed).toMatchObject({ interview_format: 'one_on_one' });
    });

    it('rejects a payload missing dynamic_question_answers', () => {
      const pipe = new ZodValidationPipe(InterviewPrepIntakeAnswersSchema);

      expect(() =>
        pipe.transform({
          interview_format: 'panel',
          weak_topics_selected: [],
        }),
      ).toThrow();
    });

    it('rejects an interview_format value outside the panel/one_on_one/unknown enum', () => {
      const pipe = new ZodValidationPipe(InterviewPrepIntakeAnswersSchema);

      expect(() =>
        pipe.transform({
          interview_format: 'group',
          weak_topics_selected: [],
          dynamic_question_answers: [],
        }),
      ).toThrow();
    });
  });

  describe('generateInterviewPrepReportStream (SSE)', () => {
    it('streams progress events then a done event matching the finalize/stream SSE frame convention', async () => {
      const res = fakeResponse();
      applicationsService.generateInterviewPrepReport.mockImplementation(
        async (userId, id, onProgress) => {
          onProgress('Preparing technical talking points...');
          onProgress('Preparing behavioral talking points...');
          return { technical_topics: [], gaps_to_address: [], behavioral_questions: [], talking_points: [] };
        },
      );

      await controller.generateInterviewPrepReportStream(req, res, 'app-1');

      expect(res.headers['Content-Type']).toBe('text/event-stream');
      expect(res.headers['Cache-Control']).toBe('no-cache');
      expect(res.headers['Connection']).toBe('keep-alive');

      const frames = parseSSEFrames(res.writes);
      expect(frames[0].event).toBe('progress');
      expect(frames[1].event).toBe('progress');
      expect(frames[2]).toEqual({
        event: 'done',
        data: { technical_topics: [], gaps_to_address: [], behavioral_questions: [], talking_points: [] },
      });
      expect(res.ended).toBe(true);
    });

    it('streams an error event (not an uncaught exception) when generating a report for an application owned by someone else', async () => {
      const res = fakeResponse();
      applicationsService.generateInterviewPrepReport.mockRejectedValue(
        new Error('Application not found'),
      );

      await controller.generateInterviewPrepReportStream(ATTACKER, res, 'someone-elses-app');

      const frames = parseSSEFrames(res.writes);
      expect(frames).toEqual([{ event: 'error', data: { message: 'Application not found' } }]);
      expect(res.ended).toBe(true);
    });

    it('streams a clean error event (not an uncaught exception) when the intake answers precondition has not been met', async () => {
      const res = fakeResponse();
      applicationsService.generateInterviewPrepReport.mockRejectedValue(
        new BadRequestException('Answer the interview prep intake questions first'),
      );

      await controller.generateInterviewPrepReportStream(req, res, 'app-1');

      const frames = parseSSEFrames(res.writes);
      expect(frames).toEqual([
        { event: 'error', data: { message: 'Answer the interview prep intake questions first' } },
      ]);
      expect(res.ended).toBe(true);
    });

    it('scopes the report generation to the authenticated session user and route id, never a client-supplied userId', async () => {
      const res = fakeResponse();
      applicationsService.generateInterviewPrepReport.mockResolvedValue({
        technical_topics: [],
        gaps_to_address: [],
        behavioral_questions: [],
        talking_points: [],
      });

      await controller.generateInterviewPrepReportStream(req, res, 'app-1');

      expect(applicationsService.generateInterviewPrepReport).toHaveBeenCalledWith(
        'user-1',
        'app-1',
        expect.any(Function),
      );
    });
  });

  describe('interview-prep throttle limits match the analyze/stream convention', () => {
    // @Throttle stores its options directly on the method descriptor's
    // function value via Reflect.defineMetadata(THROTTLER_LIMIT/TTL + name, ...).
    // Reading it back the same way proves the decorator is actually wired,
    // not just present in source.
    const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMITdefault';
    const THROTTLER_TTL_KEY = 'THROTTLER:TTLdefault';

    it('applies the same limit/ttl to POST :id/interview-prep/intake as analyze/stream', () => {
      const expectedLimit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        ApplicationsController.prototype.analyzeStream,
      );
      const expectedTtl = Reflect.getMetadata(
        THROTTLER_TTL_KEY,
        ApplicationsController.prototype.analyzeStream,
      );

      expect(expectedLimit).toBeDefined();
      expect(
        Reflect.getMetadata(
          THROTTLER_LIMIT_KEY,
          ApplicationsController.prototype.generateInterviewPrepIntake,
        ),
      ).toBe(expectedLimit);
      expect(
        Reflect.getMetadata(
          THROTTLER_TTL_KEY,
          ApplicationsController.prototype.generateInterviewPrepIntake,
        ),
      ).toBe(expectedTtl);
    });

    it('applies the same limit/ttl to POST :id/interview-prep/generate/stream as analyze/stream', () => {
      const expectedLimit = Reflect.getMetadata(
        THROTTLER_LIMIT_KEY,
        ApplicationsController.prototype.analyzeStream,
      );
      const expectedTtl = Reflect.getMetadata(
        THROTTLER_TTL_KEY,
        ApplicationsController.prototype.analyzeStream,
      );

      expect(
        Reflect.getMetadata(
          THROTTLER_LIMIT_KEY,
          ApplicationsController.prototype.generateInterviewPrepReportStream,
        ),
      ).toBe(expectedLimit);
      expect(
        Reflect.getMetadata(
          THROTTLER_TTL_KEY,
          ApplicationsController.prototype.generateInterviewPrepReportStream,
        ),
      ).toBe(expectedTtl);
    });
  });

  describe('route declaration order (dashboard-summary vs :id greedy-match regression)', () => {
    // NestJS's RouterExplorer registers routes by walking
    // Object.getOwnPropertyNames(prototype) in declaration order, then
    // Express matches same-specificity routes in registration order. If
    // `getById` (`@Get(':id')`) were declared before `dashboardSummary`
    // (`@Get('dashboard-summary')`), `GET /applications/dashboard-summary`
    // would be greedily swallowed by `:id` with id === 'dashboard-summary'.
    // This inspects the actual mechanism Nest relies on for registration
    // order — it is NOT a substitute for an e2e/HTTP-level test hitting the
    // real router (see report).
    it('declares dashboardSummary before getById on the controller prototype', () => {
      const methodNames = Object.getOwnPropertyNames(ApplicationsController.prototype);

      expect(methodNames.indexOf('dashboardSummary')).toBeLessThan(methodNames.indexOf('getById'));
    });

    it('declares list before getById on the controller prototype', () => {
      const methodNames = Object.getOwnPropertyNames(ApplicationsController.prototype);

      expect(methodNames.indexOf('list')).toBeLessThan(methodNames.indexOf('getById'));
    });
  });
});

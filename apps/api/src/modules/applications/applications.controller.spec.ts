import { Response } from 'express';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { LocalStorageService } from '../../common/storage/local-storage.service';
import { AuthGuard } from '../auth/auth.guard';

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
  };
  let storage: { get: jest.Mock };
  let controller: ApplicationsController;
  const req = { user: { id: 'user-1' } };

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
});

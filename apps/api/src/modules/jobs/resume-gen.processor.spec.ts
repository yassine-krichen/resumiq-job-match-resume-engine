import type { Job } from 'bullmq';
import { ResumeGenProcessor } from './resume-gen.processor';
import { ApplicationsService } from '../applications/applications.service';

const USER_ID = 'user-1';
const JOB_ID = 'job-1';
const APP_ID = 'app-1';

function bullJobFixture(): Job<{ userId: string; jobId: string }> {
  return { id: 'bull-job-1', data: { userId: USER_ID, jobId: JOB_ID } } as Job<{
    userId: string;
    jobId: string;
  }>;
}

describe('ResumeGenProcessor', () => {
  let applicationsService: {
    draftForExistingJob: jest.Mock;
    finalizeAndDraftEmail: jest.Mock;
    confirm: jest.Mock;
  };
  let processor: ResumeGenProcessor;

  beforeEach(() => {
    applicationsService = {
      draftForExistingJob: jest.fn(),
      finalizeAndDraftEmail: jest.fn(),
      confirm: jest.fn(),
    };
    processor = new ResumeGenProcessor(applicationsService as unknown as ApplicationsService);
  });

  it('drafts against the existing scraped job using the swipe-right userId/jobId', async () => {
    applicationsService.draftForExistingJob.mockResolvedValue({
      applicationId: APP_ID,
      matchScore: 20,
      reasons: [],
      gapReport: { match_score: 20, missing_skills: [], strengths: [], recommendations: [] },
    });

    await processor.process(bullJobFixture());

    expect(applicationsService.draftForExistingJob).toHaveBeenCalledWith(
      USER_ID,
      JOB_ID,
      expect.any(Function),
    );
  });

  it('does not finalize/draft an email when the draft result is a gap report (no resume selection)', async () => {
    applicationsService.draftForExistingJob.mockResolvedValue({
      applicationId: APP_ID,
      matchScore: 20,
      reasons: [],
      gapReport: { match_score: 20, missing_skills: [], strengths: [], recommendations: [] },
    });

    await processor.process(bullJobFixture());

    expect(applicationsService.finalizeAndDraftEmail).not.toHaveBeenCalled();
  });

  it('finalizes and drafts the email only when the draft result carries a resume selection', async () => {
    applicationsService.draftForExistingJob.mockResolvedValue({
      applicationId: APP_ID,
      matchScore: 80,
      reasons: ['Strong match'],
      selection: { reasoning: 'r' },
    });
    applicationsService.finalizeAndDraftEmail.mockResolvedValue({
      applicationId: APP_ID,
      pdfPath: 'p',
      emailDraft: { subject: 's', body: 'b' },
    });

    await processor.process(bullJobFixture());

    expect(applicationsService.finalizeAndDraftEmail).toHaveBeenCalledWith(
      USER_ID,
      APP_ID,
      expect.any(Function),
    );
  });

  it('never calls confirm() — background swipe-right applications must land at email_drafted, never auto-advance to ready', async () => {
    applicationsService.draftForExistingJob.mockResolvedValue({
      applicationId: APP_ID,
      matchScore: 80,
      reasons: ['Strong match'],
      selection: { reasoning: 'r' },
    });
    applicationsService.finalizeAndDraftEmail.mockResolvedValue({
      applicationId: APP_ID,
      pdfPath: 'p',
      emailDraft: { subject: 's', body: 'b' },
    });

    await processor.process(bullJobFixture());

    expect(applicationsService.confirm).not.toHaveBeenCalled();
  });

  it('never calls confirm() even on the gap-report path', async () => {
    applicationsService.draftForExistingJob.mockResolvedValue({
      applicationId: APP_ID,
      matchScore: 20,
      reasons: [],
      gapReport: { match_score: 20, missing_skills: [], strengths: [], recommendations: [] },
    });

    await processor.process(bullJobFixture());

    expect(applicationsService.confirm).not.toHaveBeenCalled();
  });

  it('propagates a rejection from draftForExistingJob (e.g. no career profile) rather than swallowing it', async () => {
    applicationsService.draftForExistingJob.mockRejectedValue(new Error('Career profile required'));

    await expect(processor.process(bullJobFixture())).rejects.toThrow('Career profile required');
    expect(applicationsService.finalizeAndDraftEmail).not.toHaveBeenCalled();
  });
});

import type { Job } from 'bullmq';
import { MatchPreviewProcessor } from './match-preview.processor';
import { JobsService } from './jobs.service';

describe('MatchPreviewProcessor', () => {
  let jobsService: { refreshMatchPreviews: jest.Mock };
  let processor: MatchPreviewProcessor;

  beforeEach(() => {
    jobsService = { refreshMatchPreviews: jest.fn() };
    processor = new MatchPreviewProcessor(jobsService as unknown as JobsService);
  });

  it('delegates to JobsService.refreshMatchPreviews with the job-data userId', async () => {
    jobsService.refreshMatchPreviews.mockResolvedValue({ refreshed: 5 });

    await processor.process({ id: 'bull-1', data: { userId: 'user-1' } } as Job<{ userId: string }>);

    expect(jobsService.refreshMatchPreviews).toHaveBeenCalledWith('user-1');
  });

  it('propagates a rejection from refreshMatchPreviews so BullMQ retry/backoff can observe the failure', async () => {
    jobsService.refreshMatchPreviews.mockRejectedValue(new Error('db unavailable'));

    await expect(
      processor.process({ id: 'bull-1', data: { userId: 'user-1' } } as Job<{ userId: string }>),
    ).rejects.toThrow('db unavailable');
  });
});

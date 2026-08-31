import type { Job } from 'bullmq';
import { JobScraperProcessor } from './job-scraper.processor';
import { JobsService } from './jobs.service';

describe('JobScraperProcessor', () => {
  let jobsService: { ingestFromScanner: jest.Mock };
  let processor: JobScraperProcessor;

  beforeEach(() => {
    jobsService = { ingestFromScanner: jest.fn() };
    processor = new JobScraperProcessor(jobsService as unknown as JobsService);
  });

  it('delegates the scheduled scan run to JobsService.ingestFromScanner', async () => {
    jobsService.ingestFromScanner.mockResolvedValue({ scanned: 10, created: 3 });

    await processor.process({ id: 'bull-1' } as Job);

    expect(jobsService.ingestFromScanner).toHaveBeenCalledWith();
  });

  it('propagates a rejection from ingestFromScanner so BullMQ retry/backoff can observe the failure', async () => {
    jobsService.ingestFromScanner.mockRejectedValue(new Error('scanner network error'));

    await expect(processor.process({ id: 'bull-1' } as Job)).rejects.toThrow('scanner network error');
  });
});

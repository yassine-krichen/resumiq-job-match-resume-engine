import { JobsScheduler } from './jobs.scheduler';

describe('JobsScheduler', () => {
  let jobScraperQueue: { add: jest.Mock };
  let scheduler: JobsScheduler;

  beforeEach(() => {
    jobScraperQueue = { add: jest.fn() };
    scheduler = new JobsScheduler(jobScraperQueue as never);
  });

  it('enqueues a "scan" job on the daily trigger, delegating retry/backoff to BullMQ rather than reimplementing it', async () => {
    await scheduler.triggerDailyScan();

    expect(jobScraperQueue.add).toHaveBeenCalledWith('scan', {});
  });
});

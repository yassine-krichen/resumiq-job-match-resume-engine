import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Queue } from 'bullmq';
import { DiscoverFeedFiltersSchema, UpdateUserSettingsSchema } from '@resumiq/schemas';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
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

describe('JobsController', () => {
  let jobsService: {
    getDiscoverFeed: jest.Mock;
    dismiss: jest.Mock;
    swipeRight: jest.Mock;
    refreshMatchPreviews: jest.Mock;
    getUserSettings: jest.Mock;
    updateUserSettings: jest.Mock;
  };
  let jobScraperQueue: { add: jest.Mock };
  let controller: JobsController;
  const OWNER = { user: { id: 'user-1' } };
  const ATTACKER = { user: { id: 'user-attacker' } };

  beforeEach(() => {
    jobsService = {
      getDiscoverFeed: jest.fn(),
      dismiss: jest.fn(),
      swipeRight: jest.fn(),
      refreshMatchPreviews: jest.fn(),
      getUserSettings: jest.fn(),
      updateUserSettings: jest.fn(),
    };
    jobScraperQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    controller = new JobsController(
      jobsService as unknown as JobsService,
      jobScraperQueue as unknown as Queue,
    );
  });

  describe('scanNow', () => {
    it('enqueues a scan job on the job-scraper queue and returns its id', async () => {
      const result = await controller.scanNow();

      expect(jobScraperQueue.add).toHaveBeenCalledWith('scan', {});
      expect(result).toEqual({ queued: true, jobId: 'job-1' });
    });
  });

  it('is guarded by AuthGuard on every route (class-level @UseGuards)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, JobsController);
    expect(guards).toContain(AuthGuard);
  });

  describe('discover', () => {
    it('scopes the feed lookup to the authenticated session user, never a client-supplied id', async () => {
      jobsService.getDiscoverFeed.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
      const filters = { page: 1, page_size: 20 } as never;

      await controller.discover(OWNER, filters);

      expect(jobsService.getDiscoverFeed).toHaveBeenCalledWith('user-1', filters);
    });
  });

  describe('dismiss', () => {
    it("scopes the dismiss write to the authenticated session user, ignoring any client-supplied userId", async () => {
      const result = await controller.dismiss(ATTACKER, 'job-1');

      expect(jobsService.dismiss).toHaveBeenCalledWith('user-attacker', 'job-1');
      expect(result).toEqual({ dismissed: true });
    });
  });

  describe('swipeRight', () => {
    it('scopes the swipe-right enqueue to the authenticated session user', async () => {
      const result = await controller.swipeRight(OWNER, 'job-1');

      expect(jobsService.swipeRight).toHaveBeenCalledWith('user-1', 'job-1');
      expect(result).toEqual({ queued: true });
    });
  });

  describe('refreshPreviews', () => {
    it('delegates to refreshMatchPreviews scoped to the session user and returns its result', async () => {
      jobsService.refreshMatchPreviews.mockResolvedValue({ refreshed: 3 });

      const result = await controller.refreshPreviews(OWNER);

      expect(jobsService.refreshMatchPreviews).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ refreshed: 3 });
    });
  });

  describe('getSettings / updateSettings', () => {
    it('getSettings scopes the lookup to the session user', async () => {
      jobsService.getUserSettings.mockResolvedValue({ match_threshold: 50 });

      await controller.getSettings(OWNER);

      expect(jobsService.getUserSettings).toHaveBeenCalledWith('user-1');
    });

    it('updateSettings scopes the write to the session user and passes the validated patch through', async () => {
      jobsService.updateUserSettings.mockResolvedValue({ match_threshold: 80 });
      const patch = { match_threshold: 80 } as never;

      await controller.updateSettings(OWNER, patch);

      expect(jobsService.updateUserSettings).toHaveBeenCalledWith('user-1', patch);
    });
  });

  describe('discover-feed and settings validation schemas (as wired via ZodValidationPipe)', () => {
    it('DiscoverFeedFiltersSchema coerces query-string page/page_size and comma-separated list params', () => {
      const pipe = new ZodValidationPipe(DiscoverFeedFiltersSchema);

      const parsed = pipe.transform({
        page: '2',
        page_size: '10',
        category_tags: 'backend,platform',
        work_mode: 'remote,hybrid',
      });

      expect(parsed).toEqual({
        page: 2,
        page_size: 10,
        category_tags: ['backend', 'platform'],
        work_mode: ['remote', 'hybrid'],
      });
    });

    it('DiscoverFeedFiltersSchema rejects a page_size above its max of 50', () => {
      const pipe = new ZodValidationPipe(DiscoverFeedFiltersSchema);

      expect(() => pipe.transform({ page_size: '500' })).toThrow();
    });

    it('UpdateUserSettingsSchema (settings PATCH body) rejects an out-of-range match_threshold', () => {
      const pipe = new ZodValidationPipe(UpdateUserSettingsSchema);

      expect(() => pipe.transform({ match_threshold: 101 })).toThrow();
    });

    it('UpdateUserSettingsSchema accepts a partial patch with only one field set', () => {
      const pipe = new ZodValidationPipe(UpdateUserSettingsSchema);

      expect(pipe.transform({ auto_send_email: true })).toEqual({ auto_send_email: true });
    });
  });
});

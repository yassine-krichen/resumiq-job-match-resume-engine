import { Response } from 'express';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService, IngestUserFacingError } from './onboarding.service';
import { ProfileService } from '../profile/profile.service';
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

function fakeResponse(): Response & { writes: string[]; ended: boolean } {
  const res = {
    writes: [] as string[],
    ended: false,
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write(chunk: string) {
      this.writes.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
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

describe('OnboardingController', () => {
  let onboardingService: { parseCareerText: jest.Mock };
  let profileService: { getProfile: jest.Mock; mergeSections: jest.Mock };
  let controller: OnboardingController;
  const REQ = { user: { id: 'user-1' } };

  beforeEach(() => {
    onboardingService = { parseCareerText: jest.fn() };
    profileService = { getProfile: jest.fn(), mergeSections: jest.fn() };
    controller = new OnboardingController(
      onboardingService as unknown as OnboardingService,
      profileService as unknown as ProfileService,
    );
  });

  it('is guarded by AuthGuard on every route (class-level @UseGuards)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, OnboardingController);
    expect(guards).toContain(AuthGuard);
  });

  describe('ingestStream (parse-only)', () => {
    const experienceEntry = { company: 'Acme', role: 'Engineer' };
    const certificationEntry = { name: 'AWS Certified Developer', issuer: 'AWS' };
    const projectEntry = { name: 'Side Project X' };

    it('sends a "done" event with the parsed entries and droppedEntries, and never persists anything', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockResolvedValue({
        entries: [
          { type: 'experience', entry: experienceEntry, missingFields: [] },
          { type: 'certification', entry: certificationEntry, missingFields: [] },
          { type: 'project', entry: projectEntry, missingFields: [] },
        ],
        droppedEntries: [],
      });

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      const frames = parseSSEFrames(res.writes);
      const doneFrame = frames.find((f) => f.event === 'done');
      expect(doneFrame?.data).toEqual({
        parsed: [
          { type: 'experience', entry: experienceEntry, missingFields: [] },
          { type: 'certification', entry: certificationEntry, missingFields: [] },
          { type: 'project', entry: projectEntry, missingFields: [] },
        ],
        droppedEntries: [],
      });
      expect(doneFrame?.data).not.toHaveProperty('profile');
      expect(profileService.mergeSections).not.toHaveBeenCalled();
      expect(res.ended).toBe(true);
    });

    it('threads droppedEntries from parseCareerText into the "done" event payload when some AI-extracted entries were dropped', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockResolvedValue({
        entries: [{ type: 'experience', entry: experienceEntry, missingFields: [] }],
        droppedEntries: [
          { type: 'unknown_type', reason: 'unrecognized or missing "type"', snippet: '{}' },
          { type: 'award', reason: 'failed lenient validation', snippet: '{}' },
        ],
      });

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      const frames = parseSSEFrames(res.writes);
      const doneFrame = frames.find((f) => f.event === 'done');
      expect(doneFrame?.data).toEqual({
        parsed: [{ type: 'experience', entry: experienceEntry, missingFields: [] }],
        droppedEntries: [
          { type: 'unknown_type', reason: 'unrecognized or missing "type"', snippet: '{}' },
          { type: 'award', reason: 'failed lenient validation', snippet: '{}' },
        ],
      });
    });

    it('loads the existing profile and passes it to parseCareerText as extraction context', async () => {
      const existingProfile = { skills: { programming_languages: ['TypeScript'] } };
      profileService.getProfile.mockResolvedValue(existingProfile);
      onboardingService.parseCareerText.mockResolvedValue({
        entries: [{ type: 'experience', entry: experienceEntry, missingFields: [] }],
        droppedEntries: [],
      });

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      expect(profileService.getProfile).toHaveBeenCalledWith('user-1');
      expect(onboardingService.parseCareerText).toHaveBeenCalledWith(
        'some text',
        existingProfile,
        expect.any(Function),
      );
    });

    it('sends an "error" event with the user-facing message and ends the stream when parsing fails with IngestUserFacingError, without persisting anything', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockRejectedValue(
        new IngestUserFacingError(
          "Couldn't parse that text into your profile — try rephrasing or breaking it into shorter pieces.",
        ),
      );

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      const frames = parseSSEFrames(res.writes);
      const errorFrame = frames.find((f) => f.event === 'error');
      expect(errorFrame?.data).toEqual({
        message: "Couldn't parse that text into your profile — try rephrasing or breaking it into shorter pieces.",
      });
      expect(profileService.mergeSections).not.toHaveBeenCalled();
      expect(res.ended).toBe(true);
    });

    it('sends the clean parse-timeout message as an "error" event when parseCareerText times out', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockRejectedValue(
        new IngestUserFacingError('Taking longer than expected — try shortening the input or try again.'),
      );

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      const frames = parseSSEFrames(res.writes);
      const errorFrame = frames.find((f) => f.event === 'error');
      expect(errorFrame?.data).toEqual({
        message: 'Taking longer than expected — try shortening the input or try again.',
      });
      expect(profileService.mergeSections).not.toHaveBeenCalled();
      expect(res.ended).toBe(true);
    });

    it('sends a generic error message and never leaks the raw error when parseCareerText throws a non-user-facing error', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockRejectedValue(new Error('Prisma connection reset at 10.0.0.5'));

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      const frames = parseSSEFrames(res.writes);
      const errorFrame = frames.find((f) => f.event === 'error');
      expect(errorFrame?.data).toEqual({
        message: 'Something went wrong while parsing your text. Please try again.',
      });
      expect(profileService.mergeSections).not.toHaveBeenCalled();
      expect(res.ended).toBe(true);
    });
  });

  describe('confirmIngest', () => {
    it('maps every confirmed entry type to its MasterDB section and persists the whole batch in a single mergeSections call', async () => {
      const finalProfile = { experience: [{ company: 'Acme' }] } as never;
      profileService.mergeSections.mockResolvedValue(finalProfile);

      const body = {
        entries: [
          { type: 'experience' as const, entry: { company: 'Acme' } },
          { type: 'project' as const, entry: { name: 'Side Project X' } },
          { type: 'education' as const, entry: { institution: 'State U' } },
          { type: 'certification' as const, entry: { name: 'AWS Certified' } },
          { type: 'award' as const, entry: { title: 'Employee of the Year' } },
          { type: 'skills' as const, entry: { programming_languages: ['TypeScript'] } },
          { type: 'summary' as const, entry: { target_role: 'Backend Engineer' } },
          { type: 'publication' as const, entry: { title: 'Scaling Postgres' } },
          { type: 'volunteering' as const, entry: { organization: 'Code.org' } },
          { type: 'interest' as const, entry: 'Chess' },
        ],
      };

      const result = await controller.confirmIngest(REQ, body as never);

      expect(profileService.mergeSections).toHaveBeenCalledTimes(1);
      expect(profileService.mergeSections).toHaveBeenCalledWith('user-1', [
        { section: 'experience', entry: { company: 'Acme' } },
        { section: 'projects', entry: { name: 'Side Project X' } },
        { section: 'education', entry: { institution: 'State U' } },
        { section: 'certifications', entry: { name: 'AWS Certified' } },
        { section: 'awards_and_honors', entry: { title: 'Employee of the Year' } },
        { section: 'skills', entry: { programming_languages: ['TypeScript'] } },
        { section: 'summaries', entry: { target_role: 'Backend Engineer' } },
        { section: 'publications_and_speaking', entry: { title: 'Scaling Postgres' } },
        { section: 'volunteering_and_leadership', entry: { organization: 'Code.org' } },
        { section: 'interests', entry: 'Chess' },
      ]);
      expect(result).toBe(finalProfile);
    });

    it('propagates the error when mergeSections fails, without swallowing it', async () => {
      profileService.mergeSections.mockRejectedValue(new Error('DB write failed'));

      const body = { entries: [{ type: 'experience' as const, entry: { company: 'Acme' } }] };

      await expect(controller.confirmIngest(REQ, body as never)).rejects.toThrow('DB write failed');
    });
  });
});

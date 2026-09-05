import { Response } from 'express';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
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

  describe('ingestStream', () => {
    const experienceEntry = { company: 'Acme', role: 'Engineer' };
    const certificationEntry = { name: 'AWS Certified Developer', issuer: 'AWS' };
    const projectEntry = { name: 'Side Project X' };

    it('calls mergeSections once, with every extracted entry mapped to its section, as a single atomic batch', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockResolvedValue({
        entries: [
          { type: 'experience', entry: experienceEntry },
          { type: 'certification', entry: certificationEntry },
          { type: 'project', entry: projectEntry },
        ],
      });
      profileService.mergeSections.mockResolvedValue({} as never);

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      expect(profileService.mergeSections).toHaveBeenCalledTimes(1);
      expect(profileService.mergeSections).toHaveBeenCalledWith('user-1', [
        { section: 'experience', entry: experienceEntry },
        { section: 'certifications', entry: certificationEntry },
        { section: 'projects', entry: projectEntry },
      ]);
    });

    it('sends a "done" event with the final merged profile and the parsed entries', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockResolvedValue({
        entries: [{ type: 'experience', entry: experienceEntry }],
      });
      const finalProfile = { experience: [experienceEntry] };
      profileService.mergeSections.mockResolvedValue(finalProfile);

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      const frames = parseSSEFrames(res.writes);
      const doneFrame = frames.find((f) => f.event === 'done');
      expect(doneFrame?.data).toEqual({
        profile: finalProfile,
        parsed: [{ type: 'experience', entry: experienceEntry }],
      });
      expect(res.ended).toBe(true);
    });

    it('sends an "error" event and ends the stream when parsing fails, without merging anything', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockRejectedValue(
        new Error("Couldn't parse that text into your profile — try rephrasing or breaking it into shorter pieces."),
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

    it('merges nothing and reports the error when mergeSections fails partway through the batch (atomicity)', async () => {
      profileService.getProfile.mockResolvedValue(null);
      onboardingService.parseCareerText.mockResolvedValue({
        entries: [
          { type: 'experience', entry: experienceEntry },
          { type: 'project', entry: projectEntry },
        ],
      });
      profileService.mergeSections.mockRejectedValue(new Error('DB write failed'));

      const res = fakeResponse();
      await controller.ingestStream(REQ, res, { raw_text: 'some text' });

      // A single mergeSections call means there's no way for it to have
      // partially applied entries before throwing — the whole batch is one
      // read + one write, so failure means zero entries landed.
      expect(profileService.mergeSections).toHaveBeenCalledTimes(1);
      const frames = parseSSEFrames(res.writes);
      const errorFrame = frames.find((f) => f.event === 'error');
      expect(errorFrame?.data).toEqual({ message: 'DB write failed' });
      expect(res.ended).toBe(true);
    });
  });
});

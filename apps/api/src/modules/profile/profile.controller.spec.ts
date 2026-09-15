import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MasterDBSchema, type MasterDB } from '@resumiq/schemas';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
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

function buildMasterDB(overrides: Partial<MasterDB> = {}): MasterDB {
  return {
    personal_info: {
      name: 'Jane Doe',
      location: 'Berlin',
      phone: '',
      email: 'jane@example.com',
      work_authorization: [],
      clearances: [],
      links: [],
    },
    summaries: [],
    experience: [],
    education: [],
    projects: [],
    skills: {
      programming_languages: [],
      frameworks_and_libraries: [],
      infrastructure_and_tools: [],
      databases: [],
      spoken_languages: [],
      soft_skills: [],
    },
    certifications: [],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
    ...overrides,
  };
}

describe('ProfileController', () => {
  let profileService: {
    getProfile: jest.Mock;
    upsertProfile: jest.Mock;
    importProfile: jest.Mock;
  };
  let controller: ProfileController;
  const REQ = { user: { id: 'user-1' } };

  beforeEach(() => {
    profileService = {
      getProfile: jest.fn(),
      upsertProfile: jest.fn(),
      importProfile: jest.fn(),
    };
    controller = new ProfileController(profileService as unknown as ProfileService);
  });

  it('is guarded by AuthGuard on every route (class-level @UseGuards)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ProfileController);
    expect(guards).toContain(AuthGuard);
  });

  describe('getProfile', () => {
    it('returns the profile for the authenticated user', async () => {
      const profile = buildMasterDB();
      profileService.getProfile.mockResolvedValue(profile);

      const result = await controller.getProfile(REQ);

      expect(profileService.getProfile).toHaveBeenCalledWith('user-1');
      expect(result).toBe(profile);
    });

    it('throws NotFoundException when no profile exists yet', async () => {
      profileService.getProfile.mockResolvedValue(null);

      await expect(controller.getProfile(REQ)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it("delegates to ProfileService#upsertProfile scoped to the authenticated user's id", async () => {
      const updated = buildMasterDB();
      profileService.upsertProfile.mockResolvedValue(updated);
      const patch = { personal_info: buildMasterDB().personal_info };

      const result = await controller.updateProfile(REQ, patch);

      expect(profileService.upsertProfile).toHaveBeenCalledWith('user-1', patch);
      expect(result).toBe(updated);
    });
  });

  describe('importProfile (POST /profile/import)', () => {
    it("delegates to ProfileService#importProfile scoped to the authenticated user's id and returns the merged profile", async () => {
      const merged = buildMasterDB({ experience: [] });
      profileService.importProfile.mockResolvedValue(merged);
      const body = buildMasterDB();

      const result = await controller.importProfile(REQ, body);

      expect(profileService.importProfile).toHaveBeenCalledWith('user-1', body);
      expect(result).toBe(merged);
    });

    it('propagates the error when importProfile fails, without swallowing it', async () => {
      profileService.importProfile.mockRejectedValue(new Error('DB write failed'));

      await expect(controller.importProfile(REQ, buildMasterDB())).rejects.toThrow(
        'DB write failed',
      );
    });
  });

  describe('MasterDBSchema (as wired via ZodValidationPipe on POST /profile/import)', () => {
    it('returns the parsed data unchanged when the import body is a fully valid MasterDB', () => {
      const pipe = new ZodValidationPipe(MasterDBSchema);
      const valid = buildMasterDB();

      expect(pipe.transform(valid)).toEqual(valid);
    });

    it('rejects an import body missing a required field (personal_info.name) with a 400, and never reaches the service', () => {
      const pipe = new ZodValidationPipe(MasterDBSchema);
      const invalid = buildMasterDB();
      // @ts-expect-error deliberately violating the schema to assert runtime rejection
      delete invalid.personal_info.name;

      expect(() => pipe.transform(invalid)).toThrow(BadRequestException);
      expect(profileService.importProfile).not.toHaveBeenCalled();
    });

    it('rejects an experience entry whose company name exceeds the 200-character max, and never reaches the service', () => {
      const pipe = new ZodValidationPipe(MasterDBSchema);
      const invalid = buildMasterDB({
        experience: [
          {
            company: 'a'.repeat(201),
            company_industry: '',
            role: 'Engineer',
            location: '',
            location_type: '',
            startDate: '2020',
            endDate: '',
            isCurrent: false,
            core_competencies: [],
            technologies_used: [],
            raw_achievements: [],
            quantifiable_metrics: [],
          },
        ],
      });

      expect(() => pipe.transform(invalid)).toThrow(BadRequestException);
      expect(profileService.importProfile).not.toHaveBeenCalled();
    });

    it('rejects a body where personal_info is the wrong type, and never reaches the service', () => {
      const pipe = new ZodValidationPipe(MasterDBSchema);
      const invalid = { ...buildMasterDB(), personal_info: 'not-an-object' };

      expect(() => pipe.transform(invalid)).toThrow(BadRequestException);
      expect(profileService.importProfile).not.toHaveBeenCalled();
    });

    it('rejects a body missing an entire required section (skills)', () => {
      const pipe = new ZodValidationPipe(MasterDBSchema);
      const invalid = buildMasterDB() as Partial<MasterDB>;
      delete invalid.skills;

      expect(() => pipe.transform(invalid)).toThrow(BadRequestException);
      expect(profileService.importProfile).not.toHaveBeenCalled();
    });
  });
});

import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ProfileService } from './profile.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  MasterDBSchema,
  ProfileEntryMutationSchema,
  UpdateCareerProfileSchema,
  type MasterDB,
  type ProfileEntryMutationDto,
  type UpdateCareerProfileDto,
} from '@resumiq/schemas';

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  async getProfile(@Req() req: { user: { id: string } }) {
    const profile = await this.profileService.getProfile(req.user.id);
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  @Patch()
  async updateProfile(
    @Req() req: { user: { id: string } },
    @Body(new ZodValidationPipe(UpdateCareerProfileSchema)) body: UpdateCareerProfileDto,
  ) {
    return this.profileService.upsertProfile(req.user.id, body);
  }

  /**
   * PATCH /profile/entries
   * Adds, updates, or removes a single entry in one array-shaped profile
   * section (the profile page's manual add/edit/delete-entry controls).
   * Unlike `PATCH /profile`, the mutation is applied server-side against a
   * transaction-fresh read (see `ProfileService#mutateSectionEntry`) instead
   * of a client-computed full-array replace, so overlapping requests can't
   * silently drop each other's entry.
   */
  @Patch('entries')
  async mutateSectionEntry(
    @Req() req: { user: { id: string } },
    @Body(new ZodValidationPipe(ProfileEntryMutationSchema)) body: ProfileEntryMutationDto,
  ) {
    return this.profileService.mutateSectionEntry(req.user.id, body);
  }

  /**
   * POST /profile/import
   * Merges an uploaded profile export into the caller's own profile.
   * Validated against the full `MasterDBSchema` — an import file is at least
   * as untrusted as LLM-extracted onboarding output, so it goes through the
   * same `ZodValidationPipe` convention rather than a looser shape check.
   * Merge semantics (append arrays, dedupe-merge skills) are the same ones
   * `ProfileService.mergeSections` already uses for onboarding-confirm — see
   * `ProfileService.importProfile`.
   */
  @Post('import')
  async importProfile(
    @Req() req: { user: { id: string } },
    @Body(new ZodValidationPipe(MasterDBSchema)) body: MasterDB,
  ) {
    return this.profileService.importProfile(req.user.id, body);
  }
}

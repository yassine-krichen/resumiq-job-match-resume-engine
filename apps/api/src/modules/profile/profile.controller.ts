import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ProfileService } from './profile.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UpdateCareerProfileSchema, type UpdateCareerProfileDto } from '@resumiq/schemas';

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
}

import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';

@Module({
  imports: [PrismaModule, AuthModule, ProfileModule, OnboardingModule],
})
export class AppModule {}

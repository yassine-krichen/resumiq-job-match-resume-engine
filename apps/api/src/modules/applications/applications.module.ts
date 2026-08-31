import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ProfileModule } from '../profile/profile.module';
import { ResumeModule } from '../resume/resume.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [ProfileModule, ResumeModule, StorageModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}

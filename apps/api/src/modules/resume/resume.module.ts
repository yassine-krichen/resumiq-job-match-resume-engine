import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { ResumeService } from './resume.service';

@Module({
  imports: [StorageModule],
  providers: [ResumeService],
  exports: [ResumeService],
})
export class ResumeModule {}

import { Global, Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { S3StorageAdapter, StorageAdapter } from './storage.adapter';
import { MediaPurposeGuard } from '../vcans-orders/test-purpose.guard';

@Global()
@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaPurposeGuard, { provide: StorageAdapter, useClass: S3StorageAdapter }],
  exports: [MediaService, StorageAdapter],
})
export class MediaModule {}

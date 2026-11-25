import { Global, Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { S3StorageAdapter, StorageAdapter } from './storage.adapter';

@Global()
@Module({
  controllers: [MediaController],
  providers: [MediaService, { provide: StorageAdapter, useClass: S3StorageAdapter }],
  exports: [MediaService, StorageAdapter],
})
export class MediaModule {}

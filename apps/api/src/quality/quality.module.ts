import { Global, Module } from '@nestjs/common';
import { QualityService } from './quality.service';

@Global()
@Module({ providers: [QualityService], exports: [QualityService] })
export class QualityModule {}

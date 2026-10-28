import { Module } from '@nestjs/common';
import { StandardsController, TemplatesController } from './standards.controller';
import { StandardsService } from './standards.service';

@Module({ controllers: [StandardsController, TemplatesController], providers: [StandardsService], exports: [StandardsService] })
export class StandardsModule {}

import { Module } from '@nestjs/common';
import { StandardsModule } from '../standards/standards.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({ imports: [StandardsModule], controllers: [TasksController], providers: [TasksService], exports: [TasksService] })
export class TasksModule {}

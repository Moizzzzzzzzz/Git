import { Module } from '@nestjs/common';
import { StandardsModule } from '../standards/standards.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskPurposeGuard } from '../vcans-orders/test-purpose.guard';

@Module({ imports: [StandardsModule], controllers: [TasksController], providers: [TasksService, TaskPurposeGuard], exports: [TasksService] })
export class TasksModule {}

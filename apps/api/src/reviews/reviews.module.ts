import { Module } from '@nestjs/common';
import { InspectionsModule } from '../inspections/inspections.module';
import { TasksModule } from '../tasks/tasks.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({ imports: [InspectionsModule, TasksModule], controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}

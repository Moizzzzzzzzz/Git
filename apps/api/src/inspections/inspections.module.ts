import { Module } from '@nestjs/common';
import { InspectionAccess, ReviewRouting } from './inspection-access';
import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';

@Module({
  controllers: [InspectionsController],
  providers: [InspectionsService, InspectionAccess, ReviewRouting],
  exports: [InspectionsService, InspectionAccess, ReviewRouting],
})
export class InspectionsModule {}

import { Module } from '@nestjs/common';
import { InspectionAccess, ReviewRouting } from './inspection-access';
import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';
import { InspectionPurposeGuard } from '../vcans-orders/test-purpose.guard';

@Module({
  controllers: [InspectionsController],
  providers: [InspectionsService, InspectionAccess, ReviewRouting, InspectionPurposeGuard],
  exports: [InspectionsService, InspectionAccess, ReviewRouting],
})
export class InspectionsModule {}

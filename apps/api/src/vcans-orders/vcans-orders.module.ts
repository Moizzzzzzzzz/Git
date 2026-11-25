import { Module } from '@nestjs/common';
import { VcansLabelController } from './vcans-label.controller';
import { VcansLabelService } from './vcans-label.service';
import { VcansReportController } from './vcans-report.controller';
import { VcansReportService } from './vcans-report.service';
import { VcansImportController } from './vcans-import.controller';
import { VcansImportService } from './vcans-import.service';
import { VcansLotsController } from './vcans-lots.controller';
import { VcansOrdersController } from './vcans-orders.controller';
import { VcansOrdersService } from './vcans-orders.service';

@Module({ controllers: [VcansOrdersController, VcansLotsController, VcansImportController, VcansReportController, VcansLabelController], providers: [VcansOrdersService, VcansImportService, VcansReportService, VcansLabelService] })
export class VcansOrdersModule {}

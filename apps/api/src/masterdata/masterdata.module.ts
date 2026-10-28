import { Module } from '@nestjs/common';
import { CustomersController, DefectTypesController, FabricsController, LotsController } from './masterdata.controller';
import { MasterDataService } from './masterdata.service';

@Module({
  controllers: [CustomersController, FabricsController, LotsController, DefectTypesController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}

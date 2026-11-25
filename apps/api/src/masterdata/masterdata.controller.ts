import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  customerSchema,
  defectTypeSchema,
  fabricSchema,
  paginationSchema,
  productionLotSchema,
} from '@fabricqc/shared';
import { z } from 'zod';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { MANAGE_MASTER_DATA, MANAGE_STANDARDS, type Actor } from '../common/actor';
import { MasterDataService } from './masterdata.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const fabricQuery = paginationSchema.extend({ customerId: z.string().uuid().optional() });
const lotQuery = paginationSchema.extend({ fabricId: z.string().uuid().optional() });
const defectTypeQuery = z.object({ activeOnly: z.enum(['true', 'false']).default('false') });

@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: MasterDataService) {}

  @Get()
  list(@Query(zod(paginationSchema)) q: z.infer<typeof paginationSchema>) {
    return this.svc.listCustomers(q);
  }

  @Post()
  @Roles(...MANAGE_MASTER_DATA)
  create(@CurrentActor() a: Actor, @Body(zod(customerSchema)) b: z.infer<typeof customerSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createCustomer(a, b, m);
  }

  @Put(':id')
  @Roles(...MANAGE_MASTER_DATA)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(customerSchema)) b: z.infer<typeof customerSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.updateCustomer(a, id, b, m);
  }
}

@Controller('fabrics')
export class FabricsController {
  constructor(private readonly svc: MasterDataService) {}

  @Get()
  list(@Query(zod(fabricQuery)) q: z.infer<typeof fabricQuery>) {
    return this.svc.listFabrics(q);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.svc.getFabric(id);
  }

  @Post()
  @Roles(...MANAGE_MASTER_DATA)
  create(@CurrentActor() a: Actor, @Body(zod(fabricSchema)) b: z.infer<typeof fabricSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createFabric(a, b, m);
  }

  @Put(':id')
  @Roles(...MANAGE_MASTER_DATA)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(fabricSchema)) b: z.infer<typeof fabricSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.updateFabric(a, id, b, m);
  }
}

@Controller('lots')
export class LotsController {
  constructor(private readonly svc: MasterDataService) {}

  @Get()
  list(@Query(zod(lotQuery)) q: z.infer<typeof lotQuery>) {
    return this.svc.listLots(q);
  }

  @Post()
  @Roles(...MANAGE_MASTER_DATA)
  create(@CurrentActor() a: Actor, @Body(zod(productionLotSchema)) b: z.infer<typeof productionLotSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createLot(a, b, m);
  }

  @Put(':id')
  @Roles(...MANAGE_MASTER_DATA)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(productionLotSchema)) b: z.infer<typeof productionLotSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.updateLot(a, id, b, m);
  }
}

@Controller('defect-types')
export class DefectTypesController {
  constructor(private readonly svc: MasterDataService) {}

  @Get()
  list(@Query(zod(defectTypeQuery)) q: z.infer<typeof defectTypeQuery>) {
    return this.svc.listDefectTypes(q.activeOnly === 'true');
  }

  @Post()
  @Roles(...MANAGE_STANDARDS)
  create(@CurrentActor() a: Actor, @Body(zod(defectTypeSchema)) b: z.infer<typeof defectTypeSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createDefectType(a, b, m);
  }

  @Put(':id')
  @Roles(...MANAGE_STANDARDS)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(defectTypeSchema)) b: z.infer<typeof defectTypeSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.updateDefectType(a, id, b, m);
  }
}

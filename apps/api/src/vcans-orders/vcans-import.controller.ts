import { Body, Controller, Post } from '@nestjs/common';
import { RoleCode, vcansImportCommitSchema, vcansImportPreviewSchema } from '@fabricqc/shared';
import type { z } from 'zod';
import { CurrentActor, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { VcansImportService } from './vcans-import.service';

@Controller('orders/import')
@Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK)
export class VcansImportController {
  constructor(private readonly service: VcansImportService) {}
  @Post('preview')
  preview(@CurrentActor() actor: Actor, @Body(zod(vcansImportPreviewSchema)) body: z.infer<typeof vcansImportPreviewSchema>) { return this.service.preview(actor, body); }
  @Post('commit')
  commit(@CurrentActor() actor: Actor, @Body(zod(vcansImportCommitSchema)) body: z.infer<typeof vcansImportCommitSchema>) { return this.service.commit(actor, body); }
}

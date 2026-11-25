import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { RoleCode } from '@fabricqc/shared';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentActor, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { VcansLabelService } from './vcans-label.service';
const purpose = z.enum(['INITIAL', 'REPRINT']);
@Controller('rolls')
@Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
export class VcansLabelController {
  constructor(private readonly service: VcansLabelService) {}
  @Get(':id/label')
  data(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query('purpose', zod(purpose)) value: z.infer<typeof purpose>) { return this.service.data(actor, id, value); }
  @Get(':id/label.pdf')
  async pdf(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query('purpose', zod(purpose)) value: z.infer<typeof purpose>, @Res() response: Response) {
    const bytes = await this.service.pdf(actor, id, value);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(bytes);
  }
}

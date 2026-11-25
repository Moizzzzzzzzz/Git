import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentActor } from '../common/decorators';
import type { Actor } from '../common/actor';
import { VcansReportService } from './vcans-report.service';
import { OrderPurposeGuard } from './test-purpose.guard';

@Controller('orders')
@UseGuards(OrderPurposeGuard)
export class VcansReportController {
  constructor(private readonly service: VcansReportService) {}
  @Get(':id/reports')
  list(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.service.list(actor, id); }
  @Get(':id/reports/:version/pdf')
  async pdf(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Param('version', ParseIntPipe) version: number, @Res() response: Response) {
    const bytes = await this.service.pdf(actor, id, version);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(bytes);
  }
}

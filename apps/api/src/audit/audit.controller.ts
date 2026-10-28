import { Controller, Get, Query } from '@nestjs/common';
import { paginationSchema, RoleCode } from '@fabricqc/shared';
import { z } from 'zod';
import { Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { AuditService } from './audit.service';

const querySchema = paginationSchema.extend({
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().uuid().optional(),
});

@Controller('audit-logs')
@Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query(zod(querySchema)) q: z.infer<typeof querySchema>) {
    return this.audit.list(q);
  }
}

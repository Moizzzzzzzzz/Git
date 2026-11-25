import { Body, Controller, Get, Put } from '@nestjs/common';
import { RoleCode, systemSettingsSchema } from '@fabricqc/shared';
import type { z } from 'zod';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER)
  get() {
    return this.svc.get();
  }

  @Put()
  @Roles(RoleCode.ADMIN)
  update(@CurrentActor() a: Actor, @Body(zod(systemSettingsSchema)) b: z.infer<typeof systemSettingsSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.update(a, b, m);
  }
}

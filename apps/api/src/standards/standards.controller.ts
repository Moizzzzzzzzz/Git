import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  inspectionTemplateSchema,
  qualityStandardSchema,
  STANDARD_KINDS,
  standardVersionSchema,
} from '@fabricqc/shared';
import { z } from 'zod';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { MANAGE_STANDARDS, type Actor } from '../common/actor';
import { StandardsService } from './standards.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const listQuery = z.object({ kind: z.enum(STANDARD_KINDS).optional() });

@Controller('standards')
export class StandardsController {
  constructor(private readonly svc: StandardsService) {}

  @Get()
  list(@Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(q.kind);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.svc.get(id);
  }

  @Post()
  @Roles(...MANAGE_STANDARDS)
  create(@CurrentActor() a: Actor, @Body(zod(qualityStandardSchema)) b: z.infer<typeof qualityStandardSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, b, m);
  }

  @Put(':id')
  @Roles(...MANAGE_STANDARDS)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(qualityStandardSchema)) b: z.infer<typeof qualityStandardSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.update(a, id, b, m);
  }

  @Post(':id/versions')
  @Roles(...MANAGE_STANDARDS)
  createVersion(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(standardVersionSchema)) b: z.infer<typeof standardVersionSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.createVersion(a, id, b, m);
  }

  @Put('versions/:versionId')
  @Roles(...MANAGE_STANDARDS)
  updateVersion(
    @CurrentActor() a: Actor,
    @Param('versionId', uuid) id: string,
    @Body(zod(standardVersionSchema)) b: z.infer<typeof standardVersionSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.updateVersion(a, id, b, m);
  }

  @Post('versions/:versionId/publish')
  @Roles(...MANAGE_STANDARDS)
  @HttpCode(200)
  publish(@CurrentActor() a: Actor, @Param('versionId', uuid) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.publish(a, id, m);
  }
}

@Controller('templates')
export class TemplatesController {
  constructor(private readonly svc: StandardsService) {}

  @Get()
  list() {
    return this.svc.listTemplates();
  }

  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.svc.getTemplate(id);
  }

  @Post()
  @Roles(...MANAGE_STANDARDS)
  create(
    @CurrentActor() a: Actor,
    @Body(zod(inspectionTemplateSchema)) b: z.infer<typeof inspectionTemplateSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.createTemplate(a, b, m);
  }

  @Put(':id')
  @Roles(...MANAGE_STANDARDS)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(inspectionTemplateSchema)) b: z.infer<typeof inspectionTemplateSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.updateTemplate(a, id, b, m);
  }
}

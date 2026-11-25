import { Body, Controller, Get, Headers, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentActor, Public, ReqMeta, type RequestMeta } from '../common/decorators';
import { z } from 'zod';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { OrderPurposeGuard } from './test-purpose.guard';
import { CustomerShareService } from './customer-share.service';

@Controller('orders/:id/customer-shares')
@UseGuards(OrderPurposeGuard)
export class CustomerShareManagementController {
 constructor(private readonly service: CustomerShareService) {}
 @Get('preview') preview(@CurrentActor() actor:Actor,@Param('id',new ParseUUIDPipe({version:'4'})) id:string){return this.service.preview(actor,id);}
 @Get('preview/pdf') async previewPdf(@CurrentActor() actor:Actor,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Query('reportVersion',ParseIntPipe) version:number,@ReqMeta() meta:RequestMeta,@Res() res:Response){const bytes=await this.service.previewPdf(actor,id,version,meta);res.type('application/pdf').send(bytes);}
 @Post() @Throttle({ default: { limit: 10, ttl: 60_000 } }) create(@CurrentActor() actor:Actor,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body(zod(z.object({reportVersion:z.number().int().positive(),acknowledgeContent:z.boolean().optional()}).strict())) body:{reportVersion:number;acknowledgeContent?:boolean},@ReqMeta() meta:RequestMeta){return this.service.create(actor,id,body,meta);}
 @Get() list(@CurrentActor() actor:Actor,@Param('id',new ParseUUIDPipe({version:'4'})) id:string){return this.service.list(actor,id);}
 @Post(':shareId/revoke') revoke(@CurrentActor() actor:Actor,@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Param('shareId',new ParseUUIDPipe({version:'4'})) shareId:string,@ReqMeta() meta:RequestMeta){return this.service.revoke(actor,id,shareId,meta);}
}

@Controller('customer-shares/current')
@Public()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class CustomerSharePublicController {
 constructor(private readonly service:CustomerShareService) {}
 @Get() current(@Headers('x-fabricqc-share-token') token?:string){return this.service.current(token);}
 @Get('photos/:index') async photo(@Headers('x-fabricqc-share-token') token:string|undefined,@Param('index',ParseIntPipe) index:number,@Res() res:Response){const bytes=await this.service.photo(token,index);res.type('image/jpeg').send(bytes);}
 @Get('pdf') async pdf(@Headers('x-fabricqc-share-token') token:string|undefined,@Res() res:Response){const bytes=await this.service.pdf(token);res.type('application/pdf').send(bytes);}
}

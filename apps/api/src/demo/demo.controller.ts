import { Body, Controller, Get, Headers, HttpCode, Post, Header } from '@nestjs/common';
import { z } from 'zod';
import { CurrentActor, Public, ReqMeta, type RequestMeta } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { AppError } from '../common/app-error';
import type { Actor } from '../common/actor';
import { DemoProductionService } from './demo-production.service';
import { DemoSessionService } from './demo-session.service';
const choice=z.object({personaId:z.enum(['p01','p02','p03','p04','p05','p06','p07'])}).strict();
const exchange=z.object({ticket:z.string().min(1).max(4096)}).strict();
function token(header:string|undefined):string {
 const [scheme,value]=String(header??'').split(' ');if(scheme!=='Bearer'||!value)throw AppError.unauthenticated();return value;
}
@Controller('demo')
export class DemoController {
 constructor(private readonly production:DemoProductionService,private readonly sessions:DemoSessionService) {}
 @Get('capability') @Header('Cache-Control','no-store')
 capability(@CurrentActor() actor:Actor) {return this.production.capability(actor);}
 @Post('ticket') @HttpCode(200) @Header('Cache-Control','no-store')
 ticket(@CurrentActor() actor:Actor,@Body(zod(choice)) b:z.infer<typeof choice>,@ReqMeta() meta:RequestMeta) {return this.production.ticket(actor,b.personaId,meta);}
 @Public() @Post('exchange') @HttpCode(200) @Header('Cache-Control','no-store')
 exchange(@Body(zod(exchange)) b:z.infer<typeof exchange>,@Headers('authorization') header?:string) {if(header)throw AppError.badRequest('演示兑换不可携带登录凭证');return this.sessions.exchange(b.ticket);}
 @Get('me') @Header('Cache-Control','no-store')
 me(@Headers('authorization') header:string) {return this.sessions.me(token(header));}
 @Post('commit') @HttpCode(200) @Header('Cache-Control','no-store')
 commit(@Headers('authorization') header:string) {return this.sessions.commit(token(header));}
 @Post('logout') @HttpCode(200) @Header('Cache-Control','no-store')
 logout(@Headers('authorization') header:string) {return this.sessions.logout(token(header));}
}

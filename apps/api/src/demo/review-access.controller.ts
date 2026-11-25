import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { DemoSessionService } from './demo-session.service';
const credentials=z.object({username:z.string().min(1).max(128),password:z.string().min(1).max(256)}).strict();
@Controller('review-access')
export class ReviewAccessController {
 constructor(private readonly sessions:DemoSessionService){}
 @Public() @Post('login') @HttpCode(200) @Header('Cache-Control','no-store') @Throttle({default:{limit:5,ttl:60_000}})
 login(@Body(zod(credentials)) body:z.infer<typeof credentials>){return this.sessions.reviewLogin(body.username,body.password);}
}

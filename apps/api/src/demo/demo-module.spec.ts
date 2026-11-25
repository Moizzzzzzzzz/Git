import { Test } from '@nestjs/testing';
import { ConfigModule } from '../config/config.module';
import { AppConfig } from '../config/app-config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../audit/audit.module';
import { WechatModule } from '../wechat/wechat.module';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/auth.guard';

describe('默认生产模式模块接线',()=>{
 it('未配置演示密钥仍能构造守卫且不连接演示redis',async()=>{
  const config={env:{DEMO_RUNTIME_MODE:'production',DEMO_ENTRY_ENABLED:false,JWT_ACCESS_SECRET:'p'.repeat(32)}};
  const m=await Test.createTestingModule({imports:[ConfigModule,PrismaModule,AuditModule,WechatModule,AuthModule]})
   .overrideProvider(AppConfig).useValue(config).overrideProvider(PrismaService).useValue({}).compile();
  expect(m.get(AuthGuard)).toBeDefined();await m.close();
 });
});

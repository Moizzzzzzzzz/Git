import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import Redis from 'ioredis';
import { DemoController } from '../demo/demo.controller';
import { DemoProductionService } from '../demo/demo-production.service';
import { DemoSessionService } from '../demo/demo-session.service';
import { DemoSessionStore } from '../demo/demo-session.store';
import { DemoActorService } from '../demo/demo-actor.service';
import { DemoSafetyService } from '../demo/demo-safety.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.env.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'fabricqc' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'fabricqc' },
      }),
    }),
  ],
  controllers: [AuthController, DemoController],
  providers: [AuthService, TokenService, AuthGuard, DemoProductionService, DemoSessionService, DemoActorService, DemoSafetyService,
    { provide: DemoSessionStore, inject: [AppConfig], useFactory: (config: AppConfig) => new DemoSessionStore(config.env.DEMO_RUNTIME_MODE === 'demo' ? new Redis(config.env.REDIS_URL, {lazyConnect:true,maxRetriesPerRequest:1}) : ({} as Redis)) },
  ],
  exports: [AuthService, TokenService, AuthGuard],
})
export class AuthModule {}

import { Global, Module } from '@nestjs/common';
import { HttpWechatGateway, WechatGateway } from './wechat.gateway';

@Global()
@Module({
  providers: [{ provide: WechatGateway, useClass: HttpWechatGateway }],
  exports: [WechatGateway],
})
export class WechatModule {}

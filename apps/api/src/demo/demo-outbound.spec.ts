import { HttpWechatGateway } from '../wechat/wechat.gateway';
import { DeliveryService } from '../notifications/delivery.service';
describe('演示外发硬禁止',()=>{
 it('演示模式即使错误配置微信也不能调用网络',async()=>{
  const fetchSpy=jest.spyOn(global,'fetch');
  const gateway=new HttpWechatGateway({env:{DEMO_RUNTIME_MODE:'demo'},wechatConfigured:true} as never);
  await expect(gateway.code2Session('x')).rejects.toThrow();
  await expect(gateway.sendSubscribeMessage({openId:'x',templateId:'x',page:'x',data:{}})).rejects.toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();fetchSpy.mockRestore();
 });
 it('演示投递服务在查库或扣除授权前拒绝',async()=>{
  const prisma={notificationOutbox:{findUnique:jest.fn()}};
  const service=new DeliveryService(prisma as never,{} as never,{env:{DEMO_RUNTIME_MODE:'demo'}} as never);
  await expect(service.deliver('x')).rejects.toThrow();
  expect(prisma.notificationOutbox.findUnique).not.toHaveBeenCalled();
 });
});

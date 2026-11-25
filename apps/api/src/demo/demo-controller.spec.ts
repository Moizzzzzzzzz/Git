import { DemoController } from './demo.controller';
describe('演示票据交换接口',()=>{
 it('携带任何Authorization时拒绝兑换',()=>{
  const sessions={exchange:jest.fn()};
  const controller=new DemoController({} as never,sessions as never);
  expect(()=>controller.exchange({ticket:'x'},'Bearer real')).toThrow();
  expect(sessions.exchange).not.toHaveBeenCalled();
 });
});

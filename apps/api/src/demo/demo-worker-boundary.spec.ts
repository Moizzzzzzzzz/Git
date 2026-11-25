import { AppModule } from '../app.module';
describe('演示worker边界',()=>{
 it('演示模式禁止应用通过运行参数启用队列worker',()=>{
  const prior=process.env.DEMO_RUNTIME_MODE;process.env.DEMO_RUNTIME_MODE='demo';
  try {expect(()=>AppModule.register({runWorkers:true})).toThrow();}
  finally {if(prior===undefined)delete process.env.DEMO_RUNTIME_MODE;else process.env.DEMO_RUNTIME_MODE=prior;}
 });
});

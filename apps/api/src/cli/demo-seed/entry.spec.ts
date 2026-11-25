import { runDemoSeed } from '../demo-seed';
describe('seed entry',()=>{
  it('does not open database, app, or write when config is rejected',async()=>{
    const d={validateConfig:jest.fn(()=>{throw Error('bad config')}),openReadOnlyDb:jest.fn(),attest:jest.fn(),openApp:jest.fn(),install:jest.fn()};
    await expect(runDemoSeed(d)).rejects.toThrow('bad config');expect(d.openReadOnlyDb).not.toHaveBeenCalled();expect(d.openApp).not.toHaveBeenCalled();expect(d.install).not.toHaveBeenCalled();
  });
  it('closes the read-only handle and never starts app when attestation fails',async()=>{
    const close=jest.fn();const d={validateConfig:jest.fn(),openReadOnlyDb:jest.fn().mockResolvedValue({close}),attest:jest.fn().mockRejectedValue(new Error('not isolated')),openApp:jest.fn(),install:jest.fn()};
    await expect(runDemoSeed(d)).rejects.toThrow('not isolated');expect(close).toHaveBeenCalled();expect(d.openApp).not.toHaveBeenCalled();expect(d.install).not.toHaveBeenCalled();
  });
});

it('attests all resources before bootstrapping and always closes handles',async()=>{
 const calls:string[]=[];const d={validateConfig:jest.fn(()=>{calls.push('config')}),openReadOnlyDb:jest.fn(async()=>{calls.push('db');return {close:async()=>{calls.push('db-close')}}}),attest:jest.fn(async()=>{calls.push('attest')}),openApp:jest.fn(async()=>{calls.push('app');return {close:async()=>{calls.push('app-close')}}}),install:jest.fn(async()=>{calls.push('install')})};
 await runDemoSeed(d);expect(calls).toEqual(['config','db','attest','db-close','app','install','app-close']);
});

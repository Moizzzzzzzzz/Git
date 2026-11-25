import {describe,expect,it,vi,beforeEach} from 'vitest';
import Taro from '@tarojs/taro';
import {openTaskRoll} from '../src/lib/scan';
vi.mock('@tarojs/taro',()=>({default:{getStorageSync:()=>'',navigateTo:vi.fn().mockResolvedValue(undefined),showModal:vi.fn()}}));
describe('completed inspection read only route',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it.each(['APPROVED','REJECTED'])('%s opens the inspection detail instead of starting another draft',async status=>{
  await openTaskRoll('R1',[{taskRollId:'tr',status:'DONE',task:{id:'t',taskNo:'T',title:'T',defaultMode:null,defaultScope:'FULL'},inspection:{id:'i',status}}]);
  expect(Taro.navigateTo).toHaveBeenCalledWith({url:'/pages/review/detail?id=i'});expect(Taro.showModal).not.toHaveBeenCalled();
 });
});

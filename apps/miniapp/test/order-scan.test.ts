import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({navigate:vi.fn(),modal:vi.fn(),request:vi.fn()}));
vi.mock('@tarojs/taro',()=>({default:{scanCode:async()=>({result:'230E5SY82Z'}),navigateTo:h.navigate,showModal:h.modal,showLoading:vi.fn(),hideLoading:vi.fn()}}));
vi.mock('../src/lib/session-context',()=>({currentContext:()=>({kind:'real'}),assertIdentity:vi.fn()}));
vi.mock('../src/lib/api',()=>({requestScoped:h.request,toastError:vi.fn()}));
import {scanRoll} from '../src/lib/scan';
beforeEach(()=>{h.navigate.mockReset();h.modal.mockReset();h.request.mockReset();});
it('takes the first scan of an assigned H roll to sampling preparation even before task activation',async()=>{h.request.mockResolvedValue({roll:{id:'r',rollNo:'01',orderId:'order-1',fabric:null},myTasks:[]});await scanRoll();expect(h.navigate).toHaveBeenCalledWith({url:'/pages/orders/detail?id=order-1'});expect(h.modal).not.toHaveBeenCalled();});
it('preserves ordinary roll handling outside the H workflow',async()=>{h.request.mockResolvedValue({roll:{id:'r',rollNo:'01',orderId:null,fabric:null},myTasks:[]});await scanRoll();expect(h.navigate).not.toHaveBeenCalled();expect(h.modal).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('没有分配')}));});

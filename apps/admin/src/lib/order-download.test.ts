import {beforeEach,expect,it,vi} from 'vitest';
import {downloadFile,setAccessToken} from './api';
const fetchMock=vi.fn();
beforeEach(()=>{vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();setAccessToken('employee-token');});
it('uses authenticated same-origin API for a PDF',async()=>{fetchMock.mockResolvedValue(new Response('pdf',{headers:{'content-type':'application/pdf'}}));const data=await downloadFile('/orders/o/reports/1/pdf');expect(await data.text()).toBe('pdf');expect(fetchMock).toHaveBeenCalledWith('/api/orders/o/reports/1/pdf',expect.objectContaining({headers:{Authorization:'Bearer employee-token'},credentials:'same-origin'}));});
it('does not accept error pages as a report',async()=>{fetchMock.mockResolvedValue(new Response('{"message":"整单未确认"}',{status:403,headers:{'content-type':'application/json'}}));await expect(downloadFile('/orders/o/reports/1/pdf')).rejects.toThrow('整单未确认');});
it('does not attach credentials to a foreign file URL',async()=>{await expect(downloadFile('https://other.test/report')).rejects.toThrow();expect(fetchMock).not.toHaveBeenCalled();});
it('discards a file when the employee logs out while it downloads',async()=>{let finish!:(r:Response)=>void;fetchMock.mockImplementation(()=>new Promise(r=>{finish=r;}));const pending=downloadFile('/orders/o/reports/1/pdf');setAccessToken(null);finish(new Response('pdf',{headers:{'content-type':'application/pdf'}}));await expect(pending).rejects.toThrow('登录状态');});

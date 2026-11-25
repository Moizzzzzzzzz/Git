import {expect,it} from 'vitest';
import {noticeRoute} from './notice-route';
it('maps H order notices without accidentally opening legacy task IDs',()=>{expect(noticeRoute('pages/orders/detail?id=order-123')).toBe('/orders/order-123');expect(noticeRoute('/pages/business/index?id=old-123')).toBe('/business-tasks/old-123');});
it('rejects arbitrary destinations and unsafe identifiers',()=>{for(const path of ['https://other.test/pages/orders/detail?id=x','pages/orders/detail?id=../secret','pages/settings/index?id=x',null])expect(noticeRoute(path)).toBeNull();});

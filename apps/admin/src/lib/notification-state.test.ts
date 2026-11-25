import { expect, it } from 'vitest';
import { notificationText } from './notification-state';
it('never calls queued or skipped messages sent',()=>{
 expect(notificationText({status:'PENDING',reason:null})).toContain('等待');
 expect(notificationText({status:'SKIPPED',reason:'NO_CONSENT'})).toContain('未授权');
 expect(notificationText({status:'SENT',reason:null})).toContain('已发送');
 expect(notificationText({status:'SENT',reason:null})).not.toContain('已阅读');
});

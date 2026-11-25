import { createPrivateKey, createPublicKey } from 'node:crypto';
import type { Env } from '../config/env';

/** Conservative deployment prerequisites; live DB marker/privilege checks are separate. */
export function validateDemoConfig(e:Env):void {
 const reject=()=>{throw new Error('演示环境隔离配置不符合要求');};
 if(e.DEMO_RUNTIME_MODE!=='demo') {
  if(!e.DEMO_ENTRY_ENABLED)return;
  try {
   if(!e.DEMO_ALLOWED_USER_ID||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.DEMO_ALLOWED_USER_ID)||!e.DEMO_CHAIN_SECRET||Buffer.byteLength(e.DEMO_CHAIN_SECRET)<32||!e.DEMO_TICKET_PRIVATE_KEY||e.DEMO_SESSION_SECRET)reject();
   const key=createPrivateKey(e.DEMO_TICKET_PRIVATE_KEY!);
   if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)reject();
   return;
  }catch {reject();}
 }
 try {
  const db=new URL(e.DATABASE_URL),redis=new URL(e.REDIS_URL),storage=new URL(e.STORAGE_ENDPOINT??''),external=new URL(e.STORAGE_PUBLIC_ENDPOINT??'');
  if(db.hostname!=='demo-db'||db.pathname!=='/fabricqc_demo'||decodeURIComponent(db.username)!=='fqc_demo_app')reject();
  if(redis.hostname!=='demo-redis'||!['redis:','rediss:'].includes(redis.protocol)||!redis.username||!redis.password||redis.username==='default')reject();
  if(!e.STORAGE_ACCESS_KEY_ID||!e.STORAGE_SECRET_ACCESS_KEY||e.STORAGE_ACCESS_KEY_ID==='minioadmin')reject();
  if(storage.hostname!=='demo-minio'||e.STORAGE_BUCKET!=='demo-media'||!e.STORAGE_FORCE_PATH_STYLE||!['minio','s3'].includes(e.STORAGE_PROVIDER))reject();
  if(external.hostname!=='192.0.2.1'||external.pathname!=='/'||external.protocol!=='https:')reject();
  if(e.RUN_WORKERS||e.DEMO_ENTRY_ENABLED||e.DEMO_TICKET_PRIVATE_KEY||e.DEMO_CHAIN_SECRET||e.DEMO_ALLOWED_USER_ID)reject();
  if(e.WECHAT_APP_ID||e.WECHAT_APP_SECRET||e.WECHAT_TPL_REVIEW_REQUEST||e.WECHAT_TPL_REVIEW_RESULT||e.WECHAT_TPL_TASK_DELIVERED)reject();
  if(!e.DEMO_TICKET_PUBLIC_KEY||!e.DEMO_SESSION_SECRET||Buffer.byteLength(e.DEMO_SESSION_SECRET)<32||e.DEMO_SESSION_SECRET===e.JWT_ACCESS_SECRET)reject();
  const key=createPublicKey(e.DEMO_TICKET_PUBLIC_KEY!);
  if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)reject();
 }catch {reject();}
}

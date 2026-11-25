import { generateKeyPairSync } from 'node:crypto';
import { DemoSafetyService } from './demo-safety.service';
const evidence={database:'fabricqc_demo',currentUser:'fqc_demo_app',sessionUser:'fqc_demo_app',owner:'fqc_demo_owner',ownerCanLogin:false,isSuperuser:false,isOwnerMember:false,hasOtherMembership:false,ownsObjects:false,canCreateDatabase:false,canCreateRole:false,markerOwner:'fqc_demo_owner',markerSchemaOwner:'fqc_demo_owner',markerSchemaWritable:false,markerReadable:true,migrationsWritable:false,markerWritable:false,publicSchemaWritable:false};
const publicKey=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}).publicKey;
const env={DEMO_RUNTIME_MODE:'demo',DEMO_ENTRY_ENABLED:false,RUN_WORKERS:false,DEMO_TICKET_PUBLIC_KEY:publicKey,DEMO_SESSION_SECRET:'x'.repeat(32),JWT_ACCESS_SECRET:'y'.repeat(32),DATABASE_URL:'postgresql://REDACTED:REDACTED@demo-db:5432/fabricqc_demo',REDIS_URL:'redis://REDACTED:REDACTED@demo-redis:6379',STORAGE_PROVIDER:'minio',STORAGE_ENDPOINT:'http://demo-minio:9000',STORAGE_PUBLIC_ENDPOINT:'https://192.0.2.1',STORAGE_BUCKET:'demo-media',STORAGE_ACCESS_KEY_ID:'demo-app',STORAGE_SECRET_ACCESS_KEY:'PUBLIC_REDACTED',STORAGE_FORCE_PATH_STYLE:true};
describe('演示启动数据库证据',()=>{
 it('只允许独立库、受限角色及唯一marker',async()=>{
  const prisma={$queryRaw:jest.fn().mockResolvedValueOnce([evidence]).mockResolvedValueOnce([{id:1,environmentId:'fabricqc-demo',resetVersion:'v1'}])};
  await expect(new DemoSafetyService({env} as never,prisma as never,{identityMarker:jest.fn().mockResolvedValue('fabricqc-demo|v1')} as never).onModuleInit()).resolves.toBeUndefined();
 });
 it('继承其他高权限角色时拒绝启动',async()=>{
  const prisma={$queryRaw:jest.fn().mockResolvedValueOnce([{...evidence,hasOtherMembership:true}]).mockResolvedValueOnce([{id:1,environmentId:'fabricqc-demo',resetVersion:'v1'}])};
  await expect(new DemoSafetyService({env} as never,prisma as never,{identityMarker:jest.fn().mockResolvedValue('fabricqc-demo|v1')} as never).onModuleInit()).rejects.toThrow();
 });
 it('权限或marker不符拒绝启动',async()=>{
  const prisma={$queryRaw:jest.fn().mockResolvedValueOnce([{...evidence,markerWritable:true}]).mockResolvedValueOnce([{id:1,environmentId:'fabricqc-demo',resetVersion:'v1'}])};
  await expect(new DemoSafetyService({env} as never,prisma as never,{identityMarker:jest.fn().mockResolvedValue('fabricqc-demo|v1')} as never).onModuleInit()).rejects.toThrow();
 });
});

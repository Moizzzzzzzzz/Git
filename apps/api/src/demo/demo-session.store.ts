import type Redis from 'ioredis';

export interface DemoCandidate { jti:string; sid:string; chainId:string; personaId:string; actorId:string; resetVersion:string; ttlSeconds?:number }
const PREFIX='fqc:demo:v1:';
const CREATE = `
if redis.call('SET',KEYS[1],'1','NX','EX',120)==false then return 'TICKET_USED' end
local gen=redis.call('HGET',KEYS[2],'generation') or '0'
redis.call('HSET',KEYS[3],'chainId',ARGV[1],'personaId',ARGV[2],'actorId',ARGV[3],'resetVersion',ARGV[4],'generation',gen,'state','PENDING')
redis.call('EXPIRE',KEYS[3],ARGV[5])
redis.call('HSETNX',KEYS[2],'generation',gen)
redis.call('EXPIRE',KEYS[2],ARGV[6])
return 'OK'`;
const COMMIT = `
local state=redis.call('HGET',KEYS[1],'state')
if not state then return 'EXPIRED' end
if redis.call('HGET',KEYS[1],'chainId')~=ARGV[1] then return 'INVALID' end
local active=redis.call('HGET',KEYS[2],'active')
if state=='ACTIVE' and active==ARGV[2] then return 'ACTIVE' end
if state~='PENDING' then return 'CHANGED' end
local gen=redis.call('HGET',KEYS[2],'generation') or '0'
if redis.call('HGET',KEYS[1],'generation')~=gen then return 'CHANGED' end
if active and active~=ARGV[2] then
 local old=ARGV[3]..active
 if redis.call('EXISTS',old)==1 then redis.call('HSET',old,'state','REVOKED') end
end
redis.call('HSET',KEYS[1],'state','ACTIVE')
redis.call('HSET',KEYS[2],'active',ARGV[2])
redis.call('HINCRBY',KEYS[2],'generation',1)
redis.call('EXPIRE',KEYS[2],ARGV[4])
return 'ACTIVE'`;
const LOGOUT = `
if redis.call('HGET',KEYS[1],'chainId')~=ARGV[1] then return 'INVALID' end
redis.call('HSET',KEYS[1],'state','REVOKED')
if redis.call('HGET',KEYS[2],'active')==ARGV[2] then
 redis.call('HDEL',KEYS[2],'active');redis.call('HINCRBY',KEYS[2],'generation',1);redis.call('EXPIRE',KEYS[2],660)
end
return 'OK'`;
export class DemoSessionStore {
 private closed=false;
 constructor(private readonly redis:Redis) {}
 onModuleDestroy():void { if (this.closed) return; this.closed=true; if (typeof this.redis.disconnect === 'function') this.redis.disconnect(); }
 async createCandidate(c:DemoCandidate):Promise<string> {
  const ttl=c.ttlSeconds??300;if(!Number.isSafeInteger(ttl)||ttl<1||ttl>7200)throw new Error('invalid session TTL');
  return String(await this.redis.eval(CREATE,3,`${PREFIX}ticket:${c.jti}`,`${PREFIX}chain:${c.chainId}`,`${PREFIX}session:${c.sid}`,c.chainId,c.personaId,c.actorId,c.resetVersion,ttl,ttl*2+60));
 }
 async commit(sid:string,chainId:string,ttlSeconds=300):Promise<string> {
  if(!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>7200)throw new Error('invalid session TTL');
  return String(await this.redis.eval(COMMIT,2,`${PREFIX}session:${sid}`,`${PREFIX}chain:${chainId}`,chainId,sid,`${PREFIX}session:`,ttlSeconds*2+60));
 }
 async logout(sid:string,chainId:string):Promise<string> {
  return String(await this.redis.eval(LOGOUT,2,`${PREFIX}session:${sid}`,`${PREFIX}chain:${chainId}`,chainId,sid));
 }
 async get(sid:string):Promise<Record<string,string>> {return this.redis.hgetall(`${PREFIX}session:${sid}`);}
 async identityMarker(review=false):Promise<string|null> {return this.redis.get(review?'fqc:review:guard:identity':'fqc:demo:guard:identity');}
}

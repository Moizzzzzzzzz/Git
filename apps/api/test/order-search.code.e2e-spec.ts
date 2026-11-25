import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/token.service';
import { VcansOrdersService } from '../src/vcans-orders/vcans-orders.service';
import type { Actor } from '../src/common/actor';
import { RoleCode } from '@fabricqc/shared';

const url=process.env.SHARE_CODE_TEST_DATABASE_URL;
(url?describe:describe.skip)('订单搜索真实PG及HTTP',()=>{
 it('权限与用途保留，客户、源客户、面料、PO、H及特殊字符按字面匹配',async()=>{
  const d=JSON.parse(readFileSync('/PATH/REDACTED','utf8'));const marker=readFileSync('/PATH/REDACTED','utf8').trim();const u=new URL(url!);
  if(url!==d.url||process.env.DATABASE_URL!==url||u.hostname!=='127.0.0.1'||u.port==='5432'||u.pathname!=='/fqc_share_code_d1ca39a9989b'||decodeURIComponent(u.username)!==d.role)throw Error('拒绝非分享代码专库');
  const module=await Test.createTestingModule({imports:[AppModule.register({runWorkers:false,disableRateLimit:true})]}).compile();const app=module.createNestApplication({logger:['error']});configureApp(app);await app.init();const db=app.get(PrismaService);
  try{
   const ident=await db.$queryRawUnsafe<{db:string;usr:string}[]>('SELECT current_database() AS db,current_user AS usr');const markers=await db.$queryRawUnsafe<{record:Record<string,unknown>}[]>('SELECT row_to_json(m) AS record FROM fqc_share_guard.isolation_marker m');if(ident[0].db!==d.database||ident[0].usr!==d.role||!markers.some(x=>Object.values(x.record).includes(marker)))throw Error('隔离标记不符');
   const suffix=randomUUID().slice(0,8),salesRole=await db.role.upsert({where:{code:'SALES'},create:{code:'SALES',name:'合成业务'},update:{}});const dep=await db.department.create({data:{code:`SEARCH-${suffix}`,name:'搜索合成部门'}});const otherDep=await db.department.create({data:{code:`FOREIGN-${suffix}`,name:'搜索其他部门'}});const user=await db.user.create({data:{employeeNo:`SEARCH-${suffix}`,name:'合成业务员',departmentId:dep.id,roles:{create:{roleId:salesRole.id,departmentId:dep.id}}}});const access=(await app.get(TokenService).issue(user.id,'ADMIN_WEB',{ip:null,userAgent:null})).accessToken;
   const cust=await db.customer.create({data:{code:`REF-${suffix}`,name:`Acme%_Loom\\Fiber-${suffix}`}});
   const make=async(tag:string,opts:{purpose?:'TEST'|'UNKNOWN'|'FORMAL',foreign?:boolean,customer?:boolean,source?:'MANUAL'|'VCANS',history?:unknown,productName?:string,productCode?:string,po?:string}={})=>db.vcansOrder.create({data:{hNo:`H-${tag}-${suffix}`,businessDepartmentId:opts.foreign?otherDep.id:dep.id,createdById:user.id,source:opts.source??'MANUAL',planMode:'FULL',purpose:opts.purpose??'FORMAL',customerId:opts.customer?cust.id:null,lines:{create:{lineNo:1,customerOrderNo:opts.po,productName:opts.productName,productCode:opts.productCode,...(opts.history!==undefined?{sourceSnapshot:opts.history as never}:{})}}}});
   const linked=await make('LINK',{customer:true});const historic=await make('HIST',{source:'VCANS',history:{normalized:{customerName:`OldCustomer-${suffix}`},rawCells:{customerName:'ignore'}}});const specialHistory=await make('SPECIAL',{source:'VCANS',history:{normalized:{customerName:`Json%_Name\\Tail-${suffix}`}}});await make('NONSTRING',{source:'VCANS',history:{normalized:{customerName:42}}});const untrustedManual=await make('MANUAL',{history:{normalized:{customerName:`PretendCustomer-${suffix}`}}});const unknown=await make('UNKNOWN',{purpose:'UNKNOWN',productName:`OldFabric-${suffix}`});const conflict=await make('CONFLICT',{customer:true,source:'VCANS',history:{normalized:{customerName:`OldShadow-${suffix}`}}});const fabric=await make('FAB',{productName:`Fancy Fabric-${suffix}`,productCode:`YX-${suffix}`,po:`PO-${suffix}`});const other=await make('OTHER',{foreign:true,customer:true});const test=await make('TEST',{purpose:'TEST',customer:true});const empty=await make('EMPTY');
   const agent=request(app.getHttpServer());const search=async(q:string)=>{const r=await agent.get('/api/orders').query({q}).set('Authorization',`Bearer ${access}`);expect(r.status).toBe(200);expect(JSON.stringify(r.body)).not.toContain('sourceSnapshot');return r.body.items as {id:string;hNo:string}[]};
   const ids=(rows:{id:string}[])=>rows.map(x=>x.id);
   expect(ids(await search(`  aCmE%_loOm\\FIBER-${suffix}  `))).toEqual(expect.arrayContaining([linked.id,conflict.id]));
   expect(ids(await search(`ref-${suffix}`))).toEqual(expect.arrayContaining([linked.id,conflict.id]));
   expect(ids(await search(`oldcustomer-${suffix}`))).toContain(historic.id);expect(ids(await search(`oldshadow-${suffix}`))).not.toContain(conflict.id);
   const cn=await make('ZH',{source:'VCANS',history:{normalized:{customerName:`永盛合成客户-${suffix}`}},productName:`功能面料-${suffix}`});expect(ids(await search(`合成客户-${suffix}`))).toContain(cn.id);expect(ids(await search(`功能面料-${suffix}`))).toContain(cn.id);
   expect(ids(await search(`pretendcustomer-${suffix}`))).not.toContain(untrustedManual.id);expect(ids(await search(`oldfabric-${suffix}`))).toContain(unknown.id);
   for(const q of [`fancy fabric-${suffix}`,`yx-${suffix}`,`po-${suffix}`,`h-fab-${suffix}`])expect(ids(await search(q))).toContain(fabric.id);
   for(const q of ['%','_','\\']){const found=ids(await search(q));expect(found).toEqual(expect.arrayContaining([linked.id,conflict.id,specialHistory.id]));expect(found).not.toContain(fabric.id);expect(found).not.toContain(empty.id);expect(found).not.toContain(test.id);}
   expect(ids(await search(`json%_name\\tail-${suffix}`))).toContain(specialHistory.id);
   const acme=ids(await search(`acme%_loom`));expect(acme).not.toContain(test.id);expect(acme).not.toContain(other.id);
   const actor:Actor={userId:user.id,name:user.name,employeeNo:user.employeeNo,departmentId:dep.id,roles:[{role:RoleCode.SALES,departmentId:dep.id}],sessionId:'test',clientType:'ADMIN_WEB'};
   const demo=new VcansOrdersService(db as never,{env:{DEMO_RUNTIME_MODE:'demo'}} as never);const demoIds=(await demo.list(actor,'Acme%_Loom')).items.map(x=>x.id);expect(demoIds).toContain(test.id);expect(demoIds).not.toContain(empty.id);
   const inspectorRole=await db.role.upsert({where:{code:'INSPECTOR'},create:{code:'INSPECTOR',name:'合成跟单'},update:{}});const inspector=await db.user.create({data:{employeeNo:`INSP-${suffix}`,name:'合成跟单',roles:{create:{roleId:inspectorRole.id}}}});await db.vcansOrder.update({where:{id:other.id},data:{assignedInspectorId:inspector.id}});const inspectorToken=(await app.get(TokenService).issue(inspector.id,'ADMIN_WEB',{ip:null,userAgent:null})).accessToken;const inspectorResponse=await agent.get('/api/orders').query({q:'Acme'}).set('Authorization',`Bearer ${inspectorToken}`);expect(inspectorResponse.status).toBe(200);const inspectorIds=ids(inspectorResponse.body.items);expect(inspectorIds).toContain(other.id);expect(inspectorIds).not.toContain(linked.id);
  }finally{await app.close();}
 });
});

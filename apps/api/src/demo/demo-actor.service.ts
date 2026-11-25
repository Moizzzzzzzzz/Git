import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import type { Actor } from '../common/actor';
import { personaFor } from './demo-personas';
const SALES='47596d40-dd4a-4ca8-ab14-28e96be0489d';
const QC='e94e36a9-c71e-4958-afcc-df05d93545d5';
const scopes:Record<string,{departmentId:string|null;roleDepartmentId:string|null}>={
 p01:{departmentId:SALES,roleDepartmentId:SALES},p02:{departmentId:SALES,roleDepartmentId:SALES},p03:{departmentId:SALES,roleDepartmentId:SALES},
 p04:{departmentId:QC,roleDepartmentId:QC},p05:{departmentId:QC,roleDepartmentId:QC},p06:{departmentId:QC,roleDepartmentId:null},p07:{departmentId:null,roleDepartmentId:null},
};
@Injectable()
export class DemoActorService {
 constructor(private readonly prisma:PrismaService) {}
 async load(personaId:string,sessionId:string):Promise<Actor> {
  const p=personaFor(personaId);const scope=scopes[p.personaId];
  const u=await this.prisma.user.findUnique({where:{id:p.actorId},include:{roles:{include:{role:true}}}});
  if(!u||u.status!=='ACTIVE'||u.departmentId!==scope.departmentId||u.roles.length!==1||u.roles[0].role.code!==p.role||u.roles[0].departmentId!==scope.roleDepartmentId)throw AppError.forbidden('演示身份配置不一致');
  return {userId:u.id,name:u.name,employeeNo:u.employeeNo,departmentId:u.departmentId,roles:[{role:u.roles[0].role.code,departmentId:u.roles[0].departmentId}],sessionId,clientType:'MINIAPP'};
 }
}

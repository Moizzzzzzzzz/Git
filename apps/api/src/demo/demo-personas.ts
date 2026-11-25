import { AppError } from '../common/app-error';

export const demoPersonas = [
 {personaId:'p01',label:'业务员',role:'SALES',scopeLabel:'演示销售二部',actorId:'13943a7e-f52a-4824-984c-1771fefbd6a4'},
 {personaId:'p02',label:'部门经理',role:'BUSINESS_MANAGER',scopeLabel:'演示销售二部',actorId:'981dae6a-cea6-40e6-afa3-8cca4f9b0ba3'},
 {personaId:'p03',label:'内勤',role:'BUSINESS_CLERK',scopeLabel:'演示销售二部',actorId:'0eef16ed-7a06-43a0-b4cf-475dbed6f72a'},
 {personaId:'p04',label:'质检主管',role:'QC_SUPERVISOR',scopeLabel:'演示质检部',actorId:'68e477eb-6dcb-4f1a-a992-61957a641027'},
 {personaId:'p05',label:'质检员',role:'INSPECTOR',scopeLabel:'演示质检部',actorId:'83d6e219-1a9e-4fc9-b034-5ac89b2b3234'},
 {personaId:'p06',label:'质量经理',role:'QUALITY_MANAGER',scopeLabel:'演示环境',actorId:'ff46e22d-0f3b-464c-b8dc-864f968b310c'},
 {personaId:'p07',label:'系统管理员',role:'ADMIN',scopeLabel:'演示环境',actorId:'97c04bb3-866f-4fb0-9ce8-4718a4a26549'},
] as const;
export function personaFor(id:string) {
 const p=demoPersonas.find(v=>v.personaId===id);if(!p) throw AppError.badRequest('无效演示身份');return p;
}
export function assertAllowedOwner(userId:string,allowedId:string,enabled:boolean) {
 if(!enabled||!allowedId||userId!==allowedId) throw AppError.forbidden('当前账号未开通演示');
}

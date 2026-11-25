import { DEMO_DEPARTMENTS, DEMO_FIXTURE_KEYS, DEMO_PERSONAS } from './manifest';
describe('demo seed manifest', () => {
  it('contains the three isolated departments and seven fixed single-role actors', () => {
    expect(DEMO_DEPARTMENTS.map(d=>d.code)).toEqual(['DEMO-SALES-01','DEMO-SALES-02','DEMO-QC']);
    expect(DEMO_PERSONAS.map(p=>p.personaId)).toEqual(['p01','p02','p03','p04','p05','p06','p07']);
    expect(DEMO_PERSONAS.map(p=>p.role)).toEqual(['SALES','BUSINESS_MANAGER','BUSINESS_CLERK','QC_SUPERVISOR','INSPECTOR','QUALITY_MANAGER','ADMIN']);
    expect(new Set(DEMO_PERSONAS.map(p=>p.id)).size).toBe(7);
    expect(DEMO_PERSONAS.find(p=>p.personaId==='p01')?.id).toBe('13943a7e-f52a-4824-984c-1771fefbd6a4');
    expect(DEMO_PERSONAS.find(p=>p.personaId==='p04')?.id).toBe('68e477eb-6dcb-4f1a-a992-61957a641027');
    expect(DEMO_PERSONAS.find(p=>p.personaId==='p05')?.id).toBe('83d6e219-1a9e-4fc9-b034-5ac89b2b3234');
    for(const p of DEMO_PERSONAS.slice(0,5)) expect(p.roleDepartmentId).toBeTruthy();
    expect(DEMO_PERSONAS.slice(5).every(p=>p.roleDepartmentId===null)).toBe(true);
  });
  it('contains all fixed state samples without a fixed live task', () => {
    expect(DEMO_FIXTURE_KEYS).toEqual(['UNASSIGNED','INPROGRESS','PENDING_REVIEW','RETURNED','FINAL_PENDING','DELIVERED_PASS','DELIVERED_FAIL','OTHER_DEPT']);
  });
});

describe('synthetic base data', () => {
  it('contains two marked standards/templates, four combinations and nineteen generic defects', () => {
    const { DEMO_TEMPLATES, DEMO_STANDARDS, DEMO_FABRICS, DEMO_DEFECTS } = require('./manifest');
    expect(DEMO_TEMPLATES).toHaveLength(2);
    expect(DEMO_STANDARDS).toHaveLength(2);
    expect(DEMO_FABRICS).toHaveLength(4);
    expect(DEMO_DEFECTS).toHaveLength(19);
    expect(DEMO_STANDARDS.every((s: {version:{purpose:string}})=>s.version.purpose==='TEST')).toBe(true);
    expect(DEMO_FABRICS.every((f: {body:{code:string}})=>f.body.code.startsWith('DEMO-'))).toBe(true);
  });
});

it('includes one non-switchable synthetic owner for the other-department fixture',()=>{
  const {DEMO_SEED_ACTOR,DEMO_PERSONAS}=require('./manifest');
  expect(DEMO_SEED_ACTOR).toMatchObject({id:'b8374589-708e-4c16-893e-c46b7e07a243',employeeNo:'DEMO-SALES-01-SEED',role:'SALES',switchable:false,departmentId:'fe31afc0-ad98-41a5-9b2e-e22325e58907'});
  expect(DEMO_PERSONAS.every((p:{id:string})=>p.id!==DEMO_SEED_ACTOR.id)).toBe(true);
});

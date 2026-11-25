import { demoPersonas, personaFor, assertAllowedOwner } from './demo-personas';
describe('演示主体授权',()=>{
 it('严格固定七个不同主体',()=>{
  expect(demoPersonas).toHaveLength(7);
  expect(new Set(demoPersonas.map(p=>p.actorId)).size).toBe(7);
  expect(personaFor('p01').role).toBe('SALES');
  expect(()=>personaFor('ADMIN')).toThrow();
 });
 it('仅启用白名单本人可取票',()=>{
  expect(()=>assertAllowedOwner('a','a',true)).not.toThrow();
  expect(()=>assertAllowedOwner('b','a',true)).toThrow();
  expect(()=>assertAllowedOwner('a','a',false)).toThrow();
 });
});

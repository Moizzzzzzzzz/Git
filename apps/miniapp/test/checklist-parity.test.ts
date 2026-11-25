import {afterAll,describe,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {localEvaluation,type LocalDraft} from '../src/lib/draft';
import type {InspectionDetail} from '../src/lib/types';
import type {InspectionEvaluation} from '@fabricqc/quality-engine';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/checklist-api-snapshot.json',import.meta.url),'utf8')) as {standardSnapshot:InspectionDetail['standards'];templateSnapshot:InspectionDetail['template'];specSnapshot:InspectionDetail['spec'];base:Pick<LocalDraft,'mode'|'scope'|'segments'|'measurements'|'defects'|'photos'>;comparisons:{name:string;checklist:LocalDraft['checklist'];evaluation:InspectionEvaluation}[]};
const results:unknown[]=[];
describe('actual mini localEvaluation vs isolated API frozen snapshot',()=>{
 it.each(fixture.comparisons)('$name matches full API evaluation',sample=>{
  const d:LocalDraft={...fixture.base,inspectionId:'offline-parity',baseVersion:0,localRev:0,syncedRev:0,syncState:'idle',syncError:null,lastSyncedAt:null,savedAt:0,checklist:sample.checklist,remarks:'',serverEvaluation:null,submitKey:null,meta:{status:'DRAFT',revision:0,roll:{id:'offline-roll',rollNo:'OFFLINE',dyeLotNo:null,colorCode:null,nominalLengthM:10,fabric:{code:'OFFLINE',nameZh:'隔离夹具'}},task:{id:'offline-task',taskNo:'OFFLINE',title:'隔离夹具'},standards:fixture.standardSnapshot,template:fixture.templateSnapshot,spec:fixture.specSnapshot}};
  const actual=localEvaluation(d);
  expect(actual).toEqual(sample.evaluation);
  results.push({name:sample.name,pass:true,localEvaluation:actual,apiEvaluation:sample.evaluation});
 });
 afterAll(()=>{if(process.env.FABRICQC_COMPARISON_REPORT)writeFileSync(process.env.FABRICQC_COMPARISON_REPORT,JSON.stringify({verifiedAt:new Date().toISOString(),entry:'apps/miniapp/src/lib/draft.ts#localEvaluation',sourceFixture:'检查策略_双端同快照夹具_20261112.json',compared:'full evaluation including overall, checks, warnings and scoring',results},null,2));});
});

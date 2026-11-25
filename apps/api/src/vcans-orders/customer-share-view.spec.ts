import { buildCustomerView } from './customer-share-view';

const snapshot = {
  hNo: 'H-TEST', version: 1, confirmedAt: '2026-11-25T00:00:00.000Z', originalRequiredRolls: 1, standardName: '正式标准', standardDescription: '内部价格秘密', confirmedByName: '内部姓名', notes: '内部备注',
  plan: { mode: 'FULL' }, defectNames: { HOLE: '破洞' },
  lines: [{ id: 'line-1', customerOrderNo: 'C-1', productName: '面料', specification: '规格', color: '蓝', quantity: 100, quantityUnit: 'm', sourceSnapshot: { price: 42 } }],
  rolls: [{ id: 'roll-secret', lineId: 'line-1', lotNo: 'LOT', rollNo: 'ROLL', originalSample: true, additionalSample: false, result: 'PASS', basisHistory: { inspectionId: 'inspection-1', result: 'PASS', systemResult: 'FAIL', finalResult: 'PASS', finalReason: '质量复核通过', submittedAt: '2026-11-24T00:00:00Z', reviewedAt: '2026-11-24T01:00:00Z', inspectorName: '私密姓名', totalPoints: '20', normalizedScore: '40', resultSnapshot: {fourPoint:{scoring:{areaUnit:'PER_100_LINEAR_YD'}}}, inspection: {remarks:'价格备注秘密', defects:[{clientId:'d1',defectTypeCode:'HOLE',positionM:3,lengthCm:2,points:2}],photos:[{kind:'DEFECT',defectClientId:'d1',objectKey:'frozen-inspections/inspection-1/defect.jpg'},{kind:'CHECKPOINT',checkpointKey:'roll_label',objectKey:'frozen-inspections/inspection-1/label.jpg'}]}} }]
};
it('仅投影经确认字段、疵点关联图片和复核原因，不泄漏内部记录', () => {
 const out=buildCustomerView(snapshot);
 expect(out.view.rolls[0].history[0]).toMatchObject({finalReason:'质量复核通过',totalPoints:'20',normalizedScore:'40',photoIndexes:[0]});
 expect(out.photoRefs).toEqual([{objectKey:'frozen-inspections/inspection-1/defect.jpg'}]);
 const json=JSON.stringify(out.view); for(const secret of ['内部价格秘密','内部备注','私密姓名','价格备注秘密','roll-secret','line-1','frozen-inspections','42']) expect(json).not.toContain(secret);
});
it('拒绝跨检验图片归属和脱离疵点的照片', () => {
 const copy=structuredClone(snapshot); copy.rolls[0].basisHistory.inspection.photos[0].objectKey='frozen-inspections/other/x';
 expect(()=>buildCustomerView(copy)).toThrow();
});
it('追加复验按审核时间取最新结论，原定记录仍保留', () => {
 const copy=structuredClone(snapshot); const original=copy.rolls[0].basisHistory;
 const additional={...original,result:'FAIL',systemResult:'FAIL',finalResult:'FAIL',finalReason:'复验不合格',reviewedAt:'2026-11-24T02:00:00Z'};
 const out=buildCustomerView({...copy,rolls:[{...copy.rolls[0],additionalSample:true,additionalHistory:[additional]}]});
 expect(out.view.rolls[0].result).toBe('FAIL');expect(out.view.rolls[0].history.map(h=>h.result)).toEqual(['PASS','FAIL']);
});
it('缺失原定依据或主管最终结论的原因时拒绝生成分享', () => {
 const missing=structuredClone(snapshot); missing.rolls[0].basisHistory.finalReason='   '; expect(()=>buildCustomerView(missing)).toThrow();
 expect(()=>buildCustomerView({...snapshot,rolls:[{...snapshot.rolls[0],basisHistory:null}]})).toThrow();
});

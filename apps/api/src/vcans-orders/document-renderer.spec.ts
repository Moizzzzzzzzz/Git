import { labelMeasurement, OrderReportInput, renderOrderReport, renderRollLabels, RollLabelInput } from './document-renderer';
import PDFDocument from 'pdfkit';

const report = (): OrderReportInput => ({
  reportNumber: 'TEST-R001', hNo: 'H-TEST-001', version: 1,
  confirmedAt: '2026-11-17T02:00:00Z', confirmedByName: '测试主管', inspectorNames: ['测试质检员'],
  inspectionPlanDescription: '每缸固定抽1卷', originalRequiredRolls: 1, example: true,
  lines: [{ id: 'line1', customerOrderNo: 'TEST-PO-A', productName: '测试针织布', specification: '150cm', color: '测试蓝', quantity: '200', quantityUnit: '米' }],
  rolls: [
    { id: 'roll1', lineId: 'line1', lotNo: 'TEST-LOT1', rollNo: 'TEST-R01', originalSample: true, result: 'FAIL', nominalLengthM: '100', nominalWeightKg: '22', measuredLengthM: '99.5', measuredWeightKg: '21.8', defects: [{ name: '测试破洞', positionM: '25', lengthCm: '1', widthCm: '1' }] },
    { id: 'roll2', lineId: 'line1', lotNo: 'TEST-LOT1', rollNo: 'TEST-R02', originalSample: false, result: 'UNINSPECTED', nominalLengthM: '100', nominalWeightKg: '22' },
  ], pendingActions: ['不合格后续处理待确认'], standardName: '测试方案，非正式厂标',
});
const label = (): RollLabelInput => ({ hNo: 'H-TEST-001', lotNo: 'TEST-LOT1', rollNo: 'TEST-R01', qrCode: '230E5SY82Z', productName: '测试针织布', specification: '150cm', color: '测试蓝', customerOrderNo: 'TEST-PO-A', nominalLengthM: '100', nominalWeightKg: '22', measuredLengthM: '99.5', purpose: 'REPRINT' });
const originalPhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMUFBRkYGBgYgADAAKOADflI64iAAAAAElFTkSuQmCC', 'base64');
const additionalPhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGO8e/cuAwMDEwMYAAAfPgKb6XzMUAAAAABJRU5ErkJggg==', 'base64');
const historyReport = (): OrderReportInput => {
  const value = report();
  value.rolls = [{
    ...value.rolls[0], result: 'PASS', additionalSample: true, latestReviewedInspectionId: 'additional-approved', pendingAdditionalInspectionCount: 1,
    inspectionHistory: [
      { id: 'original-basis', inspectionNumber: 'ORIG-FAIL', kind: 'ORIGINAL', inspectedAt: '2026-11-16T01:00:00Z', reviewedAt: '2026-11-16T02:00:00Z', result: 'FAIL', inspectorName: '原定检验员', reviewerName: '原定审核人', standardName: '原定测试标准', totalPoints: '4', normalizedScore: '16', scoreUnit: '测试单位', defects: [{ name: '原定裂口', positionM: '25', points: '4' }], photos: [{ bytes: originalPhoto, defectName: '原定裂口', positionM: '25', caption: 'ORIGINAL-PHOTO' }] },
      { id: 'additional-approved', inspectionNumber: 'ADD-PASS', kind: 'ADDITIONAL', inspectedAt: '2026-11-17T00:00:00Z', reviewedAt: '2026-11-17T01:00:00Z', result: 'PASS', inspectorName: '复验检验员', reviewerName: '复验审核人', standardName: '追加测试标准', totalPoints: '0', normalizedScore: '0', scoreUnit: '测试单位', conclusionNote: '已审核复验记录', photos: [{ bytes: additionalPhoto, defectName: '复验位置', positionM: '25', caption: 'ADDITIONAL-PHOTO' }] },
    ],
  }];
  return value;
};

describe('order document renderer (pure, no database or network)', () => {
  it('shows only meaningful photo captions and positions while preserving zero metres', async () => {
    const value = report();
    value.rolls[0].photos = [
      { bytes: originalPhoto, caption: '卷标', defectName: '  ', positionM: null },
      { bytes: originalPhoto, caption: '布面', positionM: '' },
      { bytes: originalPhoto, defectName: '裂口', positionM: '25' },
      { bytes: originalPhoto, defectName: '起始疵点', positionM: 0 },
    ];
    const texts: string[] = [];
    const originalText = PDFDocument.prototype.text;
    const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: PDFKit.PDFDocument, text: string, ...args: unknown[]) {
      texts.push(text);
      return (originalText as (...values: unknown[]) => PDFKit.PDFDocument).apply(this, [text, ...args]);
    } as typeof originalText);
    try {
      await renderOrderReport(value);
      const captions = texts.filter(text => text.startsWith('卷 TEST-R01 / 缸 TEST-LOT1'));
      expect(captions).toEqual([
        '卷 TEST-R01 / 缸 TEST-LOT1', // Roll section heading.
        '卷 TEST-R01 / 缸 TEST-LOT1',
        '卷 TEST-R01 / 缸 TEST-LOT1',
        '卷 TEST-R01 / 缸 TEST-LOT1 · 裂口 · 米位 25 m',
        '卷 TEST-R01 / 缸 TEST-LOT1 · 起始疵点 · 米位 0 m',
      ]);
      expect(texts).toContain('卷标');
      expect(texts).toContain('布面');
    } finally { spy.mockRestore(); }
  });
  it('renders confirmed failed results with pending follow-up and uninspected rolls', async () => {
    const pdf = await renderOrderReport(report());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(1);
  });
  it('rejects mismatched original selections and incomplete original inspections', async () => {
    const mismatch = report(); mismatch.originalRequiredRolls = 2;
    await expect(renderOrderReport(mismatch)).rejects.toThrow('原定应检数量');
    const incomplete = report(); incomplete.rolls[0].result = 'INCOMPLETE';
    await expect(renderOrderReport(incomplete)).rejects.toThrow('尚未完成');
  });
  it('rejects unmatched detail references and missing timestamp zone', async () => {
    const invalid = report(); invalid.rolls[0].lineId = 'other-order-line';
    await expect(renderOrderReport(invalid)).rejects.toThrow('对应订单明细');
    const time = report(); time.confirmedAt = '2026-11-17 10:00';
    await expect(renderOrderReport(time)).rejects.toThrow('时区');
  });
  it('preserves independent measurement sources and numeric zero', () => {
    expect(labelMeasurement(label(), 'length')).toEqual({ value: '99.5', source: '实测' });
    expect(labelMeasurement(label(), 'weight')).toEqual({ value: '22', source: '标称' });
    expect(labelMeasurement({ ...label(), purpose: 'INITIAL' }, 'length')).toEqual({ value: '100', source: '标称' });
    expect(labelMeasurement({ ...label(), measuredWeightKg: 0 }, 'weight')).toEqual({ value: '0', source: '实测' });
    expect(labelMeasurement({ ...label(), nominalWeightKg: null }, 'weight')).toEqual({ value: '-', source: '未填写' });
  });
  it('renders the original QR payload and rejects oversized or unsafe media', async () => {
    const pdf = await renderRollLabels([label()]);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(1);
    await expect(renderRollLabels([label()], { widthMm: 20 })).rejects.toThrow('标签纸宽');
    await expect(renderRollLabels([{ ...label(), qrCode: 'a'.repeat(257) }])).rejects.toThrow('有效原二维码');
    await expect(renderRollLabels([{ ...label(), productName: '超长品名'.repeat(500) }])).rejects.toThrow('文字过长');
  });
  it('continues long rows and many rolls onto additional pages', async () => {
    const value = report();
    value.lines[0].specification = '中文长规格'.repeat(100);
    value.rolls.push(...Array.from({ length: 40 }, (_, i) => ({ ...value.rolls[1], id: `more${i}`, rollNo: `长卷号-${i}`, lotNo: `缸号-${i % 3}` })));
    value.rolls[0].defects?.push({ name: '连续疵点描述'.repeat(180), positionM: '88', note: '说明'.repeat(200) });
    const pdf = await renderOrderReport(value);
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(2);
  });
  it('keeps coverage and quality results on page one before sixteen long sales details', async () => {
    const value = report();
    value.lines = Array.from({ length: 16 }, (_, i) => ({
      ...value.lines[0], id: i === 0 ? 'line1' : `line${i + 1}`,
      customerOrderNo: `TEST-PO-${i + 1}`, specification: '长中文规格'.repeat(30),
    }));
    const placements: Array<{ text: string; page: number; y: unknown }> = [];
    const originalText = PDFDocument.prototype.text;
    const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: PDFKit.PDFDocument, text: string, ...args: unknown[]) {
      placements.push({ text, page: this.bufferedPageRange().count, y: args[1] });
      return (originalText as (...values: unknown[]) => PDFKit.PDFDocument).apply(this, [text, ...args]);
    } as typeof originalText);
    try {
      const pdf = await renderOrderReport(value);
      expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
      for (const prefix of ['检验覆盖与结论', '整单 2 卷', '已检合格 0 卷 / 不合格 1 卷；未检 1 卷']) {
        const entry = placements.find(item => item.text.startsWith(prefix));
        expect(entry).toBeDefined();
        expect(entry?.page).toBe(1);
        expect(entry?.y).toBeLessThan(500);
      }
      expect(placements.findIndex(item => item.text === '订单与面料')).toBeGreaterThan(
        placements.findIndex(item => item.text.startsWith('已检合格 0 卷')),
      );
      expect(placements.some(item => item.text.includes('TEST-PO-16'))).toBe(true);
      expect(placements.some(item => item.text.includes('不合格后续处理待确认'))).toBe(true);
    } finally { spy.mockRestore(); }
  });
  it('rejects URL-shaped or invalid photo payloads instead of fetching external resources', async () => {
    const value = report(); value.rolls[0].photos = [{ bytes: Buffer.from('https://untrusted.invalid/image.png') }];
    await expect(renderOrderReport(value)).rejects.toThrow('PNG/JPEG');
  });
  it('fails explicitly for missing deployment assets instead of emitting unreadable fallback text', async () => {
    await expect(renderOrderReport(report(), { assetDir: '/nonexistent-fabricqc-renderer-assets' })).rejects.toThrow('DOCUMENT_ASSETS_MISSING');
  });
  it('rejects a PNG decompression bomb before handing it to the image decoder', async () => {
    const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(1000000, 16); png.writeUInt32BE(1000000, 20);
    const value = report(); value.rolls[0].photos = [{ bytes: png }];
    await expect(renderOrderReport(value)).rejects.toThrow('像素尺寸');
  });
  it('keeps one physical roll, original failure, approved retest and attempt-specific photos distinct', async () => {
    const value = historyReport();
    const draws: Array<{ text?: string; photo?: Buffer; page: number }> = [];
    const originalText = PDFDocument.prototype.text;
    const originalImage = PDFDocument.prototype.image;
    const textSpy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: PDFKit.PDFDocument, text: string, ...args: unknown[]) {
      draws.push({ text, page: this.bufferedPageRange().count });
      return (originalText as (...values: unknown[]) => PDFKit.PDFDocument).apply(this, [text, ...args]);
    } as typeof originalText);
    const imageSpy = jest.spyOn(PDFDocument.prototype, 'image').mockImplementation(function (this: PDFKit.PDFDocument, image: string | Buffer, ...args: unknown[]) {
      if (Buffer.isBuffer(image)) draws.push({ photo: image, page: this.bufferedPageRange().count });
      return (originalImage as (...values: unknown[]) => PDFKit.PDFDocument).apply(this, [image, ...args]);
    } as typeof originalImage);
    try {
      await renderOrderReport(value);
      const texts = draws.map(item => item.text ?? '').join('\n');
      expect(draws.find(item => item.text?.startsWith('整单 1 卷'))?.page).toBe(1);
      expect(draws.find(item => item.text?.startsWith('最新已审核结果：已检合格 1 卷 / 不合格 0 卷'))?.page).toBe(1);
      expect(draws.find(item => item.text?.startsWith('原定受检结果：合格 0 卷 / 不合格 1 卷'))?.page).toBe(1);
      expect(texts).toContain('追加检验待完成或审核：1 次');
      expect(texts).toContain('本次结果：不合格');
      expect(texts).toContain('本次结果：合格');
      expect(texts).toContain('提交时间：2026年11月16日 09:00');
      expect(texts).not.toContain('；检验：');
      expect(texts).toContain('原定检验 ORIG-FAIL');
      expect(texts).toContain('追加复验 ADD-PASS');
      expect(texts).toContain('原定测试标准');
      expect(texts).toContain('追加测试标准');
      expect(texts).not.toContain('测试破洞'); // Legacy aggregate details cannot replace attempt-specific evidence.
      const originalIndex = draws.findIndex(item => item.photo === originalPhoto);
      const additionalIndex = draws.findIndex(item => item.photo === additionalPhoto);
      const retestTitle = draws.findIndex(item => item.text?.startsWith('追加复验 ADD-PASS'));
      expect(originalIndex).toBeGreaterThan(draws.findIndex(item => item.text?.includes('ORIGINAL-PHOTO')));
      expect(originalIndex).toBeLessThan(retestTitle);
      expect(additionalIndex).toBeGreaterThan(retestTitle);
      expect(additionalIndex).toBeGreaterThan(draws.findIndex(item => item.text?.includes('ADDITIONAL-PHOTO')));
    } finally { textSpy.mockRestore(); imageSpy.mockRestore(); }
  });
  it('rejects draft results and inconsistent history references', async () => {
    const draft = historyReport();
    draft.rolls[0].inspectionHistory![1].result = 'INCOMPLETE' as 'PASS';
    draft.rolls[0].result = 'FAIL'; draft.rolls[0].latestReviewedInspectionId = 'original-basis';
    await expect(renderOrderReport(draft)).rejects.toThrow('只能包含已审核');
    const mismatch = historyReport(); mismatch.rolls[0].latestReviewedInspectionId = 'original-basis';
    await expect(renderOrderReport(mismatch)).rejects.toThrow('汇总结论不一致');
    const missingBasis = historyReport(); missingBasis.rolls[0].inspectionHistory!.shift();
    await expect(renderOrderReport(missingBasis)).rejects.toThrow('原定检验依据');
    const duplicate = historyReport(); duplicate.rolls[0].inspectionHistory!.push({ ...duplicate.rolls[0].inspectionHistory![1] });
    await expect(renderOrderReport(duplicate)).rejects.toThrow('重复');
  });
  it('still fits a short single-attempt history report onto one page', async () => {
    const value = historyReport();
    const roll = value.rolls[0]; roll.result = 'FAIL'; roll.additionalSample = false; roll.pendingAdditionalInspectionCount = 0;
    roll.latestReviewedInspectionId = 'original-basis';
    roll.inspectionHistory = [{ ...roll.inspectionHistory![0], photos: [], defects: [] }];
    const pdf = await renderOrderReport(value);
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(1);
  });
});

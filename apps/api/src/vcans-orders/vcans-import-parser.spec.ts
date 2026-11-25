import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { parseVcansImport, VCANS_IMPORT_LIMITS } from './vcans-import-parser';
import { syntheticBytes, syntheticVcansWorkbook, SYNTHETIC_HEADERS, SYNTHETIC_SOURCE_ROWS } from './fixtures/vcans-synthetic';
import { biffWithRecord, dishonestZip, encryptedOfficeContainer } from './fixtures/vcans-malformed';

function changed(change: (sheet: XLSX.WorkSheet, book: XLSX.WorkBook) => void, format: 'biff8' | 'xlsx' = 'xlsx') {
  const book = syntheticVcansWorkbook();
  change(book.Sheets['合成明细'], book);
  return parseVcansImport(syntheticBytes(format, book));
}
function codes(result: ReturnType<typeof parseVcansImport>) { return result.errors.map((error) => error.code); }

describe('VCANS byte parser (no service/DB/environment setup)', () => {
  it('accepts a normal uncompressed XLSX export', () => {
    const bytes = XLSX.write(syntheticVcansWorkbook(), { type: 'buffer', bookType: 'xlsx', compression: false });
    const result = parseVcansImport(bytes);
    expect(result.errors).toEqual([]);
    expect(result.canImport).toBe(true);
    expect(result.rows).toHaveLength(16);
    expect(result.groups).toHaveLength(10);
  });
  it.each(['biff8', 'xlsx'] as const)('%s: preserves 16 details / 10 H groups and skips 9 merged continuations', (format) => {
    const bytes = syntheticBytes(format), before = Buffer.from(bytes);
    const result = parseVcansImport(bytes);
    expect(result.errors).toEqual([]);
    expect(result.canImport).toBe(true);
    expect(result.format).toBe(format === 'biff8' ? 'xls' : 'xlsx');
    expect(result.sourceHash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(bytes.equals(before)).toBe(true);
    expect(result.rows.map((row) => row.sourceRow)).toEqual(SYNTHETIC_SOURCE_ROWS);
    expect(result.sheets).toEqual([{ name: '合成明细', headerRow: 3, detailCount: 16, skippedBlankRows: 9 }]);
    expect(result.groups).toHaveLength(10);
    expect(result.groups.map((group) => group.lines.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 6]);
    const lines = result.groups.flatMap((group) => group.lines);
    expect(lines.filter((line) => line.productCode === null)).toHaveLength(3);
    expect(lines.filter((line) => line.customerOrderNo === null)).toHaveLength(7);
    expect(lines.filter((line) => line.quantityUnit === '公斤')).toHaveLength(8);
    expect(lines.filter((line) => line.quantityUnit === '米')).toHaveLength(7);
    expect(lines.filter((line) => line.quantityUnit === '码')).toHaveLength(1);
    expect(new Set(result.groups[9].lines.map((line) => line.customerOrderNo)).size).toBe(6);
    expect(new Set(result.groups[9].lines.map((line) => line.sourceDyeingOrderNo)).size).toBe(1);
    expect(result.groups[0].lines[0]).toMatchObject({ productName: null, sourceBatchNo: null, quantity: '100', orderDate: { raw: '2026-01-02', isoDate: '2026-01-02' } });
    expect(result.rows[0].rawCells[3].value).toBe('.');
    expect(lines.every((line) => !('departmentId' in line) && !('rollCount' in line) && !('dyeLotNo' in line))).toBe(true);
    expect(JSON.stringify([...result.errors, ...result.warnings])).not.toMatch(/合成客户|SYN-PO/);
  });

  it('does not depend on row 3, 27-column order, a filename, or a numeric H template', () => {
    const headers = [...SYNTHETIC_HEADERS].reverse();
    const original = syntheticVcansWorkbook().Sheets['合成明细'];
    const row = SYNTHETIC_HEADERS.map((_, c) => original[XLSX.utils.encode_cell({ r: 3, c })]?.v ?? null).reverse();
    row[headers.indexOf('公司订单号')] = ' h-project/alpha_2 ';
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, row]), '重排列');
    const result = parseVcansImport(syntheticBytes('xlsx', book));
    expect(result.canImport).toBe(true);
    expect(result.groups[0].hNo).toBe('H-PROJECT/ALPHA_2');
    expect(result.rows[0]).toMatchObject({ sourceSheet: '重排列', sourceRow: 2 });
  });

  it('preserves sheet + sourceRow across multiple sheets, with combined H groups', () => {
    const result = changed((_, book) => {
      const copy = syntheticVcansWorkbook().Sheets['合成明细'];
      copy.E4 = { t: 's', v: 'SYN-ANOTHER-PO' };
      // Keep just one independent detail in a second sheet.
      const rows = [SYNTHETIC_HEADERS, SYNTHETIC_HEADERS.map((_, c) => copy[XLSX.utils.encode_cell({ r: 3, c })]?.v ?? null)];
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '第二张');
    });
    expect(result.canImport).toBe(true);
    expect(result.rows).toHaveLength(17);
    expect(result.groups[0].lines.map((line) => [line.sourceSheet, line.sourceRow])).toEqual([['合成明细', 4], ['第二张', 2]]);
  });

  it('retains same-H different products, source customer POs and salespeople without inferring departments', () => {
    const result = changed((sheet) => {
      sheet.F15 = { t: 's', v: 'SYN-DIFFERENT-PRODUCT' };
      sheet.Z15 = { t: 's', v: '合成员工丙' };
    });
    const group = result.groups.find((item) => item.hNo === 'HSYN009')!;
    expect(result.canImport).toBe(true);
    expect(group.lines).toHaveLength(2);
    expect(new Set(group.lines.map((line) => line.productCode)).size).toBe(2);
    expect(new Set(group.lines.map((line) => line.customerOrderNo)).size).toBe(2);
    expect(result.warnings.some((issue) => issue.code === 'GROUP_FIELD_VARIATION')).toBe(true);
    expect(group.lines.every((line) => !('departmentId' in line))).toBe(true);
  });

  it('does not drop hidden data or infer a permanent ID from a duplicated sourceLineId', () => {
    const result = changed((sheet, book) => {
      sheet['!rows'] = []; sheet['!rows'][4] = { hidden: true };
      sheet['!cols'] = []; sheet['!cols'][4] = { hidden: true };
      sheet.W5 = { t: 's', v: 'HSYN001-01' };
      book.Workbook = { Sheets: [{ name: '合成明细', Hidden: 1 }] };
    });
    expect(result.rows).toHaveLength(16);
    expect(result.canImport).toBe(true);
    expect(result.warnings.some((issue) => issue.code === 'REPEATED_SOURCE_LINE_ID')).toBe(true);
  });

  it('never forward-fills an unmerged missing H', () => {
    const result = changed((sheet) => { delete sheet.C5; });
    expect(codes(result)).toContain('INVALID_H_NO');
    expect(result.rows.find((row) => row.sourceRow === 5)).toBeDefined();
    expect(result.canImport).toBe(false);
  });

  it('inherits explicit vertical H merges only when the continuation has its own detail', () => {
    const result = changed((sheet) => {
      sheet['!merges']!.push(XLSX.utils.decode_range('C4:C5'));
      delete sheet.C5;
    });
    expect(result.canImport).toBe(true);
    expect(result.groups[0].lines).toHaveLength(2);
    expect(result.rows[1].rawCells[2]).toMatchObject({ value: null, inheritedFrom: 'C4' });
  });

  it('rejects nonblank notes-only continuation instead of inventing another detail', () => {
    const result = changed((sheet) => { sheet.AA11 = { t: 's', v: '合成续行说明' }; });
    expect(codes(result)).toContain('AMBIGUOUS_CONTINUATION_ROW');
    expect(result.canImport).toBe(false);
  });

  it('fails closed on repeated and duplicate headers', () => {
    expect(codes(changed((sheet) => { sheet.B3 = { t: 's', v: '公司订单号' }; }))).toContain('DUPLICATE_HEADER');
    expect(codes(changed((sheet) => {
      SYNTHETIC_HEADERS.forEach((v, c) => { sheet[XLSX.utils.encode_cell({ r: 4, c })] = { t: 's', v }; });
    }))).toContain('REPEATED_HEADER_ROW');
    expect(codes(changed((sheet) => { sheet.E3 = { t: 's', v: '未知字段' }; }))).toContain('MISSING_HEADERS');
  });

  it('does not silently skip a nonempty unrelated sheet', () => {
    const result = changed((_, book) => { XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['NOT-VCANS']]), '其他'); });
    expect(result.canImport).toBe(false);
    expect(codes(result)).toContain('HEADER_NOT_FOUND');
  });

  it('ignores empty sheets but rejects a wholly empty workbook / header-only table', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), '空白');
    expect(codes(parseVcansImport(syntheticBytes('xlsx', book)))).toContain('EMPTY_TABLE');
    book.Sheets['空白'] = XLSX.utils.aoa_to_sheet([SYNTHETIC_HEADERS]);
    expect(codes(parseVcansImport(syntheticBytes('xlsx', book)))).toContain('EMPTY_TABLE');
    expect(changed((_, wb) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), '空')).canImport).toBe(true);
  });

  it('preserves original date text and serial/date-system metadata without guessing a deadline', () => {
    const result = changed((sheet, book) => {
      book.Workbook = { WBProps: { date1904: true } };
      sheet.Q4 = { t: 'n', v: 1, z: 'yyyy-mm-dd' };
      sheet.R4 = { t: 's', v: '02/03/2026' };
      sheet.S4 = { t: 'n', v: 60, z: 'General' };
    });
    expect(result.groups[0].lines[0]).toMatchObject({
      orderDate: { raw: 1, date1904: true, isoDate: '1904-01-02' },
      totalDeliveryDate: { raw: '02/03/2026', isoDate: null },
      detailDeliveryDate: { raw: 60, isoDate: null },
    });
    expect(result.warnings.filter((warning) => warning.code === 'DATE_NOT_NORMALIZED')).toHaveLength(2);
    const leap = changed((sheet) => { sheet.Q4 = { t: 'n', v: 60, z: 'yyyy-mm-dd' }; });
    expect(leap.groups[0].lines[0].orderDate.isoDate).toBeNull();
  });

  it.each(['1,000', '-1', '1.23456', '1e3'])('rejects ambiguous/invalid quantity %s without rounding', (quantity) => {
    const result = changed((sheet) => { sheet.L4 = { t: 's', v: quantity }; });
    expect(codes(result)).toContain('INVALID_QUANTITY');
    expect(result.canImport).toBe(false);
    expect(result.rows[0].rawCells[11].value).toBe(quantity);
  });

  it('keeps zero quantity distinct from missing, and rejects unsupported units/numeric IDs', () => {
    const zero = changed((sheet) => { sheet.L4 = { t: 'n', v: 0 }; });
    expect(zero.groups[0].lines[0].quantity).toBe('0');
    expect(zero.canImport).toBe(true);
    expect(codes(changed((sheet) => { sheet.M4 = { t: 's', v: '卷' }; }))).toContain('UNSUPPORTED_UNIT');
    expect(codes(changed((sheet) => { sheet.E4 = { t: 'n', v: 123, z: '00000' }; }))).toContain('IDENTIFIER_NOT_TEXT');
  });

  it('reports duplicate details without deduplication and preserves repeated W as a warning', () => {
    const result = changed((sheet) => {
      SYNTHETIC_HEADERS.forEach((_, c) => { sheet[XLSX.utils.encode_cell({ r: 4, c })] = { ...sheet[XLSX.utils.encode_cell({ r: 3, c })] }; });
    });
    expect(result.rows).toHaveLength(16);
    expect(codes(result)).toContain('DUPLICATE_DETAIL');
    expect(result.warnings.some((warning) => warning.code === 'REPEATED_SOURCE_LINE_ID')).toBe(true);
    expect(result.canImport).toBe(false);
  });

  it('rejects formula cells, including unimported price cells, without exposing their text', () => {
    const result = changed((sheet) => { sheet.N4 = { t: 'n', v: 123, f: 'SUM(SECRET_NAME)' }; });
    expect(codes(result)).toContain('FORMULA_NOT_ALLOWED');
    expect(result.groups).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('SECRET_NAME');
  });

  it('rejects BIFF formula records and both BIFF and encrypted OOXML containers', () => {
    expect(codes(parseVcansImport(biffWithRecord(0x0006)))).toContain('FORMULA_NOT_ALLOWED');
    expect(codes(parseVcansImport(biffWithRecord(0x002f)))).toContain('ENCRYPTED_FILE');
    expect(codes(parseVcansImport(encryptedOfficeContainer()))).toContain('ENCRYPTED_FILE');
  });

  it('bounds actual decompression even when ZIP metadata lies about output size', () => {
    const bytes = dishonestZip(Buffer.alloc(VCANS_IMPORT_LIMITS.expandedBytes + 1, 65));
    expect(bytes.length).toBeLessThan(VCANS_IMPORT_LIMITS.bytes);
    const result = parseVcansImport(bytes);
    expect(codes(result)).toContain('INVALID_OR_OVERSIZED_ARCHIVE');
    expect(result.canImport).toBe(false);
    expect(result.groups).toEqual([]);
  });

  it('rejects inconsistent ZIP central/local records', () => {
    const bytes = Buffer.from(syntheticBytes('xlsx'));
    bytes.writeUInt32LE(0x7fffffff, 22);
    expect(codes(parseVcansImport(bytes))).toContain('INVALID_FILE');
  });

  it('treats a literal formula-like string as data without execution', () => {
    const result = changed((sheet) => { sheet.X4 = { t: 's', v: '=HYPERLINK("https://invalid.example")' }; });
    expect(result.canImport).toBe(true);
    expect(result.rows[0].rawCells[23].value).toMatch(/^=HYPERLINK/);
  });

  it('rejects workbook external relationships without following targets', () => {
    const result = changed((sheet) => { sheet.I4.l = { Target: 'https://invalid.example/private' }; });
    expect(codes(result)).toContain('EXTERNAL_LINK_NOT_ALLOWED');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('rejects renamed CSV/HTML, malformed ZIP/OLE and empty inputs', () => {
    for (const bytes of [Buffer.from('公司订单号,颜色\nH1,红'), Buffer.from('<html><table></table></html>')]) {
      expect(codes(parseVcansImport(bytes))).toContain('UNSUPPORTED_FILE_TYPE');
    }
    expect(codes(parseVcansImport(Buffer.alloc(0)))).toContain('EMPTY_FILE');
    expect(parseVcansImport(Buffer.from('504b0304abcd', 'hex')).canImport).toBe(false);
    expect(parseVcansImport(Buffer.from('d0cf11e0a1b11ae1', 'hex')).canImport).toBe(false);
    expect(parseVcansImport(syntheticBytes('xlsx').subarray(0, 200)).canImport).toBe(false);
  });

  it('limits bytes, sheet count, row/column bounds, cell text and overlapping merges', () => {
    expect(codes(parseVcansImport(Buffer.alloc(VCANS_IMPORT_LIMITS.bytes + 1)))).toContain('RESOURCE_LIMIT');
    expect(codes(changed((_, book) => {
      for (let i = 0; i < VCANS_IMPORT_LIMITS.sheets; i++) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), `空${i}`);
    }))).toContain('RESOURCE_LIMIT');
    expect(codes(changed((sheet) => { sheet['!ref'] = 'A1:AA10001'; sheet.A10001 = { t: 's', v: 'overflow' }; }))).toContain('RESOURCE_LIMIT');
    expect(codes(changed((sheet) => { sheet['!ref'] = 'A1:BM28'; sheet.BM4 = { t: 's', v: 'overflow' }; }))).toContain('RESOURCE_LIMIT');
    expect(codes(changed((sheet) => { sheet.X4 = { t: 's', v: 'a'.repeat(VCANS_IMPORT_LIMITS.cellChars + 1) }; }))).toContain('RESOURCE_LIMIT');
    expect(codes(changed((sheet) => { sheet['!merges']!.push(XLSX.utils.decode_range('C13:C14')); }))).toContain('AMBIGUOUS_MERGE');
  });

  it('rejects BIFF row bounds as well as XLSX bounds before parsing detail records', () => {
    const result = changed((sheet) => { sheet['!ref'] = 'A1:AA10001'; sheet.A10001 = { t: 's', v: 'overflow' }; }, 'biff8');
    expect(codes(result)).toContain('RESOURCE_LIMIT');
  });
});

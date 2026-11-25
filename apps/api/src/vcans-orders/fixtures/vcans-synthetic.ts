import * as XLSX from 'xlsx';

/** Fabricated from the documented export structure. No production file or values. */
export const SYNTHETIC_HEADERS = [
  '类型', '客户', '公司订单号', '批号', '客户订单号', '物料号', '客户料号', '规格', '颜色',
  '编号', '后道工艺', '订单量', '单位', '单价', '小缸费', '总金额', '下单日期', '总交期',
  '明细交期', '客户规格', '染整单号', '序号', '批次序号', '备注', '品类', '业务员', '工艺要求',
];
export const SYNTHETIC_SOURCE_ROWS = [4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 17, 19, 21, 23, 25, 27];

export function syntheticVcansWorkbook(): XLSX.WorkBook {
  const table: (string | number | null)[][] = Array.from({ length: 28 }, () => []);
  table[0] = ['合成销售明细，仅用于自动测试'];
  table[1] = ['2026-01-01 至 2026-01-07'];
  table[2] = [...SYNTHETIC_HEADERS];
  SYNTHETIC_SOURCE_ROWS.forEach((sourceRow, i) => {
    const group = i < 8 ? i + 1 : i < 10 ? 9 : 10;
    const detail = i < 8 ? 1 : i < 10 ? i - 7 : i - 9;
    const hNo = `HSYN${String(group).padStart(3, '0')}`;
    const missingMaterial = [3, 4, 7].includes(i);
    const customerPo = i === 5 || i >= 8 ? `SYN-PO-${i + 1}` : '';
    const unit = i >= 10 || i === 3 || i === 7 ? '公斤' : i === 2 ? '码' : '米';
    table[sourceRow - 1] = [
      missingMaterial ? '坯布合同' : '成品合同', `合成客户${Math.min(group, 8)}`, hNo,
      i < 8 ? '.' : '', customerPo, missingMaterial ? '' : `SYN-MATERIAL-${group}`,
      `SYN-CLIENT-ITEM-${i + 1}`, `合成规格${group}`, `合成颜色${detail}`, '', '合成后道',
      100 + i, unit, 1, 0, 100 + i, '2026-01-02', '2026-02-03', '2026-01-02',
      `合成客户规格${group}`, missingMaterial ? '' : `${hNo}-01`, missingMaterial ? '' : String(detail),
      `${hNo}-${String(detail).padStart(2, '0')}`, '', '合成品类', i < 8 ? '合成员工甲' : '合成员工乙',
      missingMaterial ? '' : `合成工艺${detail}`,
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet['!merges'] = [XLSX.utils.decode_range('A1:AA1'), XLSX.utils.decode_range('A2:AA2')];
  for (const row of [10, 13, 15, 17, 19, 21, 23, 25, 27]) for (const c of [...Array.from({ length: 20 }, (_, i) => i), 22, 23, 24, 25]) {
    sheet['!merges'].push({ s: { r: row - 1, c }, e: { r: row, c } });
  }
  sheet['!ref'] = 'A1:AA28';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '合成明细');
  return workbook;
}

export function syntheticBytes(bookType: 'biff8' | 'xlsx', workbook = syntheticVcansWorkbook()): Buffer {
  return XLSX.write(workbook, { type: 'buffer', bookType, compression: true }) as Buffer;
}

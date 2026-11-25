import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';

/** Pure parsing only. Never log this result: rawCells can contain customer/price data.
 * Pin the official SheetJS CE 0.20.3 tarball, not the older npm registry release.
 * No formula evaluation, network, filesystem, department inference or DB writes.
 * The HTTP owner must also limit upload size/concurrency and run untrusted parsing
 * in a worker with a deadline; byte/structure limits are not a CPU-time guarantee.
 */
export const VCANS_IMPORT_LIMITS = Object.freeze({
  bytes: 5 * 1024 * 1024, expandedBytes: 32 * 1024 * 1024, zipEntries: 512,
  sheets: 5, rowsPerSheet: 10000, columns: 64, cells: 200000,
  detailRows: 10000, groups: 1000, linesPerGroup: 500, merges: 10000,
  cellChars: 10000, textChars: 4 * 1024 * 1024, headerScanRows: 30,
});

export type VcansRawValue = string | number | boolean | null;
export interface VcansImportIssue {
  code: string;
  message: string;
  sourceSheet?: string;
  sourceRow?: number;
  column?: string;
}
export interface VcansRawCell {
  column: string;
  header: string | null;
  type: string;
  value: VcansRawValue;
  numberFormat: string | null;
  /** Only explicit vertical merges may supply a normalized value. Raw value stays unchanged. */
  inheritedFrom?: string;
}
export interface VcansRawRow {
  sourceSheet: string;
  sourceRow: number;
  rawCells: VcansRawCell[];
}
export interface VcansSourceDate {
  raw: VcansRawValue;
  numberFormat: string | null;
  date1904: boolean;
  isoDate: string | null;
}
export interface VcansImportLine {
  sourceSheet: string;
  sourceRow: number;
  hNo: string;
  customerOrderNo: string | null;
  customerName: string | null;
  productName: string | null;
  productCode: string | null;
  customerProductCode: string | null;
  specification: string | null;
  customerSpecification: string | null;
  color: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  salespersonName: string | null;
  orderType: string | null;
  postProcess: string | null;
  processRequirements: string | null;
  category: string | null;
  /** Sales identifiers only. None is a physical dye lot or roll number. */
  sourceBatchNo: string | null;
  sourceDyeingOrderNo: string | null;
  sourceSequence: string | null;
  sourceLineId: string | null;
  orderDate: VcansSourceDate;
  totalDeliveryDate: VcansSourceDate;
  detailDeliveryDate: VcansSourceDate;
}
export interface VcansImportParseResult {
  sourceHash: string;
  format: 'xls' | 'xlsx' | null;
  sheets: { name: string; headerRow: number | null; detailCount: number; skippedBlankRows: number }[];
  rows: VcansRawRow[];
  groups: { hNo: string; lines: VcansImportLine[] }[];
  errors: VcansImportIssue[];
  warnings: VcansImportIssue[];
  /** Parser eligibility only; authorization/mapping/conflict checks are still mandatory. */
  canImport: boolean;
}

const REQUIRED_HEADERS = ['公司订单号', '客户订单号', '物料号', '规格', '颜色', '订单量', '单位', '业务员'];
const L = VCANS_IMPORT_LIMITS;
class ParseFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new ParseFailure(code, message); }
function requireLimit(ok: boolean, message: string): void { if (!ok) fail('RESOURCE_LIMIT', message); }
function header(value: unknown): string { return typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim() : ''; }

/** Validate every extra-field TLV before handing the archive to another reader.
 * ZIP64 is not a supported product format, including optional ZIP64 fields in
 * otherwise small archives. Neither reader may select an alternative size/offset.
 */
function checkZipExtraFields(bytes: Buffer, start: number, length: number, boundary: number): void {
  const end = start + length;
  if (end > boundary) fail('INVALID_FILE', '压缩扩展字段超出边界');
  const ids = new Set<number>();
  for (let p = start; p < end;) {
    if (p + 4 > end) fail('INVALID_FILE', '压缩扩展字段不完整');
    const id = bytes.readUInt16LE(p), size = bytes.readUInt16LE(p + 2);
    if (id === 0x0001) fail('UNSUPPORTED_CONTAINER', '不支持ZIP64扩展字段');
    if (ids.has(id) || p + 4 + size > end) fail('INVALID_FILE', '压缩扩展字段重复或长度不一致');
    ids.add(id);
    p += 4 + size;
  }
}

function rejectZip64RecordAt(bytes: Buffer, offset: number): void {
  if (offset < 0 || offset + 4 > bytes.length) return;
  const signature = bytes.readUInt32LE(offset);
  if (signature === 0x06064b50 || signature === 0x07064b50) fail('UNSUPPORTED_CONTAINER', '不支持ZIP64目录结构');
}

/** ZIP preflight bounds actual inflation, not just attacker-controlled size metadata.
 * Require a simple, unencrypted ZIP (no ZIP64/multi-disk); validate local/central
 * agreement so SheetJS cannot later inflate a different stream from the one checked.
 */
function preflightXlsx(bytes: Buffer): void {
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0) fail('INVALID_FILE', 'Excel压缩容器不完整');
  rejectZip64RecordAt(bytes, end - 20);
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count === 0xffff || size === 0xffffffff || start === 0xffffffff) fail('UNSUPPORTED_CONTAINER', '不支持分卷或ZIP64文件');
  requireLimit(count <= L.zipEntries, '文件内部条目过多');
  rejectZip64RecordAt(bytes, start + size);
  if (start + size !== end) fail('INVALID_FILE', 'Excel压缩目录不完整');
  let p = start, total = 0, xmlCells = 0;
  const names = new Set<string>();
  const spans: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    rejectZip64RecordAt(bytes, p);
    if (p + 46 > end || bytes.readUInt32LE(p) !== 0x02014b50) fail('INVALID_FILE', 'Excel压缩目录损坏');
    const flags = bytes.readUInt16LE(p + 8), method = bytes.readUInt16LE(p + 10);
    const compressed = bytes.readUInt32LE(p + 20), expanded = bytes.readUInt32LE(p + 24);
    const nameLength = bytes.readUInt16LE(p + 28), extra = bytes.readUInt16LE(p + 30), comment = bytes.readUInt16LE(p + 32);
    const local = bytes.readUInt32LE(p + 42);
    const neededVersion = bytes.readUInt16LE(p + 6), crc = bytes.readUInt32LE(p + 16);
    if (compressed === 0xffffffff || expanded === 0xffffffff || local === 0xffffffff || bytes.readUInt16LE(p + 34) === 0xffff || neededVersion >= 45) fail('UNSUPPORTED_CONTAINER', '不支持ZIP64或高级压缩目录模式');
    if (flags & 1) fail('ENCRYPTED_FILE', '不支持加密文件，请提供未加密的导出表');
    if (flags & ~0x080e) fail('UNSUPPORTED_CONTAINER', '压缩标志不受支持');
    if (method !== 0 && method !== 8) fail('UNSUPPORTED_CONTAINER', '压缩方式不受支持');
    if (p + 46 + nameLength + extra + comment > end || local + 30 > start || bytes.readUInt16LE(p + 34)) fail('INVALID_FILE', 'Excel压缩目录损坏');
    checkZipExtraFields(bytes, p + 46 + nameLength, extra, end);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (names.has(name) || name.includes('..') || name.includes('\\') || name.startsWith('/') || name.includes('\0')) fail('INVALID_FILE', '文件内部路径无效或重复');
    names.add(name);
    rejectZip64RecordAt(bytes, local);
    if (bytes.readUInt16LE(local + 4) >= 45 || bytes.readUInt32LE(local + 18) === 0xffffffff || bytes.readUInt32LE(local + 22) === 0xffffffff) fail('UNSUPPORTED_CONTAINER', '不支持ZIP64本地记录');
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 4) !== neededVersion || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) fail('INVALID_FILE', '压缩记录不一致');
    const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtra, dataEnd = dataStart + compressed;
    if (dataEnd > start || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) fail('INVALID_FILE', '压缩记录不一致');
    checkZipExtraFields(bytes, local + 30 + localNameLength, localExtra, dataStart);
    for (const [offset, expected] of [[18, compressed], [22, expanded]]) {
      const actual = bytes.readUInt32LE(local + offset);
      if (actual !== expected && !((flags & 8) && actual === 0)) fail('INVALID_FILE', '压缩长度不一致');
    }
    const localCrc = bytes.readUInt32LE(local + 14);
    if (localCrc !== crc && !((flags & 8) && localCrc === 0)) fail('INVALID_FILE', '压缩校验记录不一致');
    if (method === 0 && compressed !== expanded) fail('INVALID_FILE', '未压缩记录长度不一致');
    let recordEnd = dataEnd;
    if (flags & 8) {
      // Only a 32-bit descriptor (with or without its optional signature) is supported.
      rejectZip64RecordAt(bytes, dataEnd);
      if (dataEnd + 12 > start) fail('INVALID_FILE', '压缩数据描述符不完整');
      const descriptor = dataEnd + (bytes.readUInt32LE(dataEnd) === 0x08074b50 ? 4 : 0);
      recordEnd = descriptor + 12;
      if (recordEnd > start || bytes.readUInt32LE(descriptor) !== crc || bytes.readUInt32LE(descriptor + 4) !== compressed || bytes.readUInt32LE(descriptor + 8) !== expanded) fail('INVALID_FILE', '压缩数据描述符不一致');
    }
    spans.push([local, recordEnd]);
    requireLimit(expanded <= L.expandedBytes - total, '解压后的文件过大');
    const input = bytes.subarray(dataStart, dataEnd);
    let content: Buffer;
    try { content = method === 0 ? input : inflateRawSync(input, { maxOutputLength: Math.max(1, L.expandedBytes - total) }); }
    catch { fail('INVALID_OR_OVERSIZED_ARCHIVE', '文件损坏或解压后的文件过大'); }
    if (content.length !== expanded) fail('INVALID_FILE', '解压长度不一致');
    total += content.length;
    requireLimit(total <= L.expandedBytes, '解压后的文件过大');
    if (/\.bin$/i.test(name) || /(?:^|\/)(?:vbaProject|activeX|embeddings|externalLinks)(?:[./]|$)/i.test(name)) fail('UNSUPPORTED_ACTIVE_CONTENT', '请导出不含宏、嵌入对象或外部链接的值表');
    if (/\.(?:xml|rels)$/i.test(name)) {
      const xml = content.toString('utf8');
      if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) fail('UNSUPPORTED_ACTIVE_CONTENT', '文件含不支持的XML声明');
      if (/<(?:\w+:)?f(?:\s|>|\/)/.test(xml)) fail('FORMULA_NOT_ALLOWED', '请将公式转换为值后重新导出');
      // Relationship targets are never fetched, even when an encoded target escapes this conservative check.
      if (/TargetMode\s*=\s*["']External["']/i.test(xml)) fail('EXTERNAL_LINK_NOT_ALLOWED', '请移除外部链接后重新导出');
      if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
        xmlCells += (xml.match(/<(?:\w+:)?c(?:\s|>)/g) ?? []).length;
        requireLimit(xmlCells <= L.cells, '文件单元格数量过多');
        for (const match of xml.matchAll(/<(?:\w+:)?c\b[^>]*\br\s*=\s*["']([A-Z]+[1-9]\d*)["']/g)) {
          const address = XLSX.utils.decode_cell(match[1]);
          requireLimit(address.r < L.rowsPerSheet && address.c < L.columns, '单元格坐标超出限制');
        }
      }
    }
    p += 46 + nameLength + extra + comment;
  }
  if (p !== end) fail('INVALID_FILE', 'Excel压缩目录长度不一致');
  spans.sort((a, b) => a[0] - b[0]);
  let nextLocal = 0;
  for (const [local, recordEnd] of spans) {
    rejectZip64RecordAt(bytes, nextLocal);
    if (local !== nextLocal) fail('INVALID_FILE', '压缩记录重叠或含未支持的附加结构');
    nextLocal = recordEnd;
  }
  rejectZip64RecordAt(bytes, nextLocal);
  if (nextLocal !== start) fail('INVALID_FILE', '压缩数据与目录之间含未支持的附加结构');
  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) fail('UNSUPPORTED_FILE_TYPE', '仅支持真实Excel .xls或.xlsx文件');
  requireLimit([...names].filter((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n)).length <= L.sheets, '工作表数量过多');
}

function preflightXls(bytes: Buffer): void {
  if (bytes.length < 512 || ![9, 12].includes(bytes.readUInt16LE(30))) fail('INVALID_FILE', 'Excel复合文档损坏');
  // The CFB reader works only on supplied bytes; it does not fetch links or run macros.
  const cfb = XLSX.CFB.read(bytes, { type: 'buffer' }) as { FileIndex: { name: string; type: number; content?: Uint8Array }[]; FullPaths: string[] };
  if (cfb.FileIndex.some((entry) => /^(?:EncryptedPackage|EncryptionInfo)$/i.test(entry.name))) fail('ENCRYPTED_FILE', '不支持加密文件，请提供未加密的导出表');
  if (cfb.FullPaths.some((path) => /\/(?:VBA|_VBA_PROJECT_CUR)\//i.test(path))) fail('UNSUPPORTED_ACTIVE_CONTENT', '请提供不含宏的值表');
  const streams = cfb.FileIndex.filter((entry) => /^(?:Workbook|Book)$/.test(entry.name) && entry.type === 2);
  if (streams.length !== 1 || !streams[0].content) fail('UNSUPPORTED_FILE_TYPE', '复合文档中没有唯一Excel工作簿');
  const stream = Buffer.from(streams[0].content);
  requireLimit(stream.length <= L.bytes, '工作簿流过大');
  if (stream.length < 8 || stream.readUInt16LE(0) !== 0x0809 || stream.readUInt16LE(4) !== 0x0600) fail('UNSUPPORTED_FILE_TYPE', '仅支持BIFF8 .xls与.xlsx文件');
  let sheets = 0, records = 0;
  for (let p = 0; p + 4 <= stream.length;) {
    const id = stream.readUInt16LE(p), length = stream.readUInt16LE(p + 2);
    if (p + 4 + length > stream.length) fail('INVALID_FILE', 'Excel记录不完整');
    if (id === 0x002f) fail('ENCRYPTED_FILE', '不支持加密文件，请提供未加密的导出表');
    if (id === 0x0006 || id === 0x0221 || id === 0x04bc) fail('FORMULA_NOT_ALLOWED', '请将公式转换为值后重新导出');
    if (id === 0x0085) { sheets++; requireLimit(sheets <= L.sheets, '工作表数量过多'); }
    if (id === 0x0200 && length >= 12) {
      requireLimit(stream.readUInt32LE(p + 8) <= L.rowsPerSheet && stream.readUInt16LE(p + 14) <= L.columns, '工作表行列超出限制');
    }
    if (id === 0x01ae && length >= 4 && ![0x0401, 0x3a01].includes(stream.readUInt16LE(p + 6))) fail('EXTERNAL_LINK_NOT_ALLOWED', '请移除外部链接后重新导出');
    records++; requireLimit(records <= L.cells * 4, 'Excel记录数量过多');
    p += 4 + length;
  }
}

function plainValue(cell: XLSX.CellObject | undefined): VcansRawValue {
  const value: unknown = cell?.v;
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}
function nonempty(cell: XLSX.CellObject | undefined): boolean {
  return !!cell && (cell.f !== undefined || cell.t === 'e' || (cell.v !== undefined && cell.v !== null && cell.v !== ''));
}
function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 9999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export function parseVcansImport(input: Uint8Array): VcansImportParseResult {
  const result: VcansImportParseResult = { sourceHash: '', format: null, sheets: [], rows: [], groups: [], errors: [], warnings: [], canImport: false };
  try {
    if (!(input instanceof Uint8Array)) fail('INVALID_INPUT', '文件内容必须为字节');
    requireLimit(input.byteLength <= L.bytes, '文件不能超过5MB');
    result.sourceHash = createHash('sha256').update(input).digest('hex');
    if (input.byteLength === 0) fail('EMPTY_FILE', '文件为空');
    const bytes = Buffer.from(input);
    if (bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) { result.format = 'xls'; preflightXls(bytes); }
    else if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) { result.format = 'xlsx'; preflightXlsx(bytes); }
    else fail('UNSUPPORTED_FILE_TYPE', '仅支持真实Excel .xls或.xlsx文件，不支持CSV/HTML改扩展名');

    const workbook = XLSX.read(bytes, {
      type: 'buffer', cellFormula: true, cellHTML: false, cellNF: true,
      cellText: false, cellDates: false, bookDeps: false, bookVBA: false,
      sheetRows: L.rowsPerSheet + 1, WTF: true,
    });
    requireLimit(workbook.SheetNames.length <= L.sheets, '工作表数量过多');
    const date1904 = !!workbook.Workbook?.WBProps?.date1904;
    let cells = 0, chars = 0;
    const groups = new Map<string, VcansImportLine[]>();
    const signatures = new Set<string>();
    const sourceLineIds = new Set<string>();
    const issue = (target: VcansImportIssue[], code: string, message: string, sourceSheet: string, sourceRow?: number, column?: string) => target.push({ code, message, sourceSheet, ...(sourceRow ? { sourceRow } : {}), ...(column ? { column } : {}) });

    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const info = { name, headerRow: null as number | null, detailCount: 0, skippedBlankRows: 0 };
      result.sheets.push(info);
      if (!sheet) fail('INVALID_FILE', '工作表内容缺失');
      const ref = sheet['!fullref'] || sheet['!ref'];
      if (!ref) { issue(result.warnings, 'EMPTY_SHEET', '空工作表已跳过', name); continue; }
      const range = XLSX.utils.decode_range(ref);
      requireLimit(range.e.r < L.rowsPerSheet && range.e.c < L.columns, '工作表行列超出限制');
      const merges = sheet['!merges'] ?? [];
      requireLimit(merges.length <= L.merges, '合并单元格数量过多');
      const inherited = new Map<string, string>();
      let mergedCells = 0;
      let usedLastRow = -1, usedLastColumn = -1;
      for (const merge of merges) {
        if (merge.s.r > merge.e.r || merge.s.c > merge.e.c) fail('INVALID_FILE', '合并区域无效');
        requireLimit(merge.e.r < L.rowsPerSheet && merge.e.c < L.columns, '合并区域超出限制');
        usedLastRow = Math.max(usedLastRow, merge.e.r); usedLastColumn = Math.max(usedLastColumn, merge.e.c);
        mergedCells += (merge.e.r - merge.s.r + 1) * (merge.e.c - merge.s.c + 1);
        requireLimit(mergedCells <= L.cells, '合并区域过大');
        const anchor = XLSX.utils.encode_cell(merge.s);
        for (let r = merge.s.r; r <= merge.e.r; r++) for (let c = merge.s.c; c <= merge.e.c; c++) {
          const address = XLSX.utils.encode_cell({ r, c });
          if (address === anchor) continue;
          if (inherited.has(address) || nonempty(sheet[address])) fail('AMBIGUOUS_MERGE', '合并区域重叠或被覆盖单元格仍有数据');
          // Horizontal title merges must never supply data to neighboring fields.
          inherited.set(address, merge.s.c === merge.e.c ? anchor : '');
        }
      }
      for (const address of Object.keys(sheet).filter((key) => !key.startsWith('!'))) {
        if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
        const cell = sheet[address] as XLSX.CellObject;
        const pos = XLSX.utils.decode_cell(address);
        requireLimit(pos.r < L.rowsPerSheet && pos.c < L.columns, '单元格坐标超出限制');
        usedLastRow = Math.max(usedLastRow, pos.r); usedLastColumn = Math.max(usedLastColumn, pos.c);
        cells++; requireLimit(cells <= L.cells, '文件单元格数量过多');
        if (cell.f !== undefined || cell.F !== undefined) fail('FORMULA_NOT_ALLOWED', '请将公式转换为值后重新导出');
        if (cell.t === 'e') issue(result.errors, 'CELL_ERROR', '单元格含错误值，请修正源文件', name, pos.r + 1, XLSX.utils.encode_col(pos.c));
        if (typeof cell.v === 'number' && !Number.isFinite(cell.v)) fail('INVALID_CELL', '文件含无效数值');
        if (typeof cell.v === 'string') {
          chars += cell.v.length;
          requireLimit(cell.v.length <= L.cellChars && chars <= L.textChars, '单元格文本过长或总文本过多');
        }
      }
      // Use actual cells/merges after validating the advertised bounds. Some BIFF
      // exporters include an extra empty trailing row in DIMENSIONS.
      if (usedLastRow < 0) { issue(result.warnings, 'EMPTY_SHEET', '空工作表已跳过', name); continue; }
      range.e.r = usedLastRow; range.e.c = usedLastColumn;
      const get = (r: number, c: number) => c < 0 ? undefined : sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      let headerRow = -1;
      for (let r = 0; r <= Math.min(range.e.r, L.headerScanRows - 1); r++) {
        if (Array.from({ length: range.e.c + 1 }, (_, c) => header(get(r, c)?.v)).includes('公司订单号')) { headerRow = r; break; }
      }
      if (headerRow < 0) { issue(result.errors, 'HEADER_NOT_FOUND', '未找到VCANS公司订单号表头', name); continue; }
      info.headerRow = headerRow + 1;
      const headers = Array.from({ length: range.e.c + 1 }, (_, c) => header(get(headerRow, c)?.v));
      const nonblankHeaders = headers.filter(Boolean);
      if (new Set(nonblankHeaders).size !== nonblankHeaders.length) { issue(result.errors, 'DUPLICATE_HEADER', '表头名称重复，无法确定字段', name, headerRow + 1); continue; }
      if (REQUIRED_HEADERS.some((key) => !headers.includes(key))) { issue(result.errors, 'MISSING_HEADERS', '缺少必要列：公司订单号、客户订单号、物料号、规格、颜色、订单量、单位、业务员', name, headerRow + 1); continue; }
      const index = (label: string) => headers.indexOf(label);
      for (let r = headerRow + 1; r <= range.e.r; r++) {
        const physical = headers.map((_, c) => get(r, c));
        if (!physical.some(nonempty)) { info.skippedBlankRows++; continue; }
        if (header(physical[index('公司订单号')]?.v) === '公司订单号') { issue(result.errors, 'REPEATED_HEADER_ROW', '数据区出现重复表头，请拆分或清理后导入', name, r + 1); continue; }
        const sourceRow = r + 1;
        const rawCells: VcansRawCell[] = physical.map((cell, c) => {
          const column = XLSX.utils.encode_col(c), anchor = inherited.get(`${column}${sourceRow}`);
          return { column, header: headers[c] || null, type: cell?.t ?? 'blank', value: plainValue(cell), numberFormat: typeof cell?.z === 'string' ? cell.z : null, ...(anchor ? { inheritedFrom: anchor } : {}) };
        });
        result.rows.push({ sourceSheet: name, sourceRow, rawCells }); info.detailCount++;
        requireLimit(result.rows.length <= L.detailRows, '明细数量过多');
        const ownH = physical[index('公司订单号')];
        if (!nonempty(ownH) && !['颜色', '订单量', '物料号', '批次序号'].some((field) => nonempty(physical[index(field)]))) {
          issue(result.errors, 'AMBIGUOUS_CONTINUATION_ROW', '非空续行缺少独立明细字段，不能自动当作新明细', name, sourceRow); continue;
        }
        const at = (label: string): XLSX.CellObject | undefined => {
          const c = index(label); if (c < 0) return undefined;
          const address = XLSX.utils.encode_cell({ r, c }), anchor = inherited.get(address);
          const own = get(r, c);
          return nonempty(own) ? own : (anchor ? sheet[anchor] : own);
        };
        const rowIssue = (code: string, message: string, label: string, warning = false) => issue(warning ? result.warnings : result.errors, code, message, name, sourceRow, index(label) < 0 ? undefined : XLSX.utils.encode_col(index(label)));
        const text = (label: string, identifier = false): string | null => {
          const cell = at(label), value = plainValue(cell);
          if (value === null || value === '') return null;
          if (identifier && typeof value !== 'string') { rowIssue('IDENTIFIER_NOT_TEXT', '标识字段必须为文本，以免丢失前导零或精度', label); return null; }
          if (typeof value === 'boolean' || cell?.t === 'e') { rowIssue('INVALID_TEXT', '文字字段类型无效', label); return null; }
          const v = String(value).trim();
          if (v.length > 500) rowIssue('FIELD_TOO_LONG', '字段超过500字符，请核对后处理', label);
          return v || null;
        };
        const date = (label: string): VcansSourceDate => {
          const cell = at(label), raw = plainValue(cell), numberFormat = typeof cell?.z === 'string' ? cell.z : null;
          let normalized: string | null = null;
          if (typeof raw === 'string') {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
            if (match) normalized = isoDate(+match[1], +match[2], +match[3]);
          } else if (typeof raw === 'number' && numberFormat && XLSX.SSF.is_date(numberFormat) && Number.isInteger(raw)) {
            const d = XLSX.SSF.parse_date_code(raw, { date1904 });
            if (d) normalized = isoDate(d.y, d.m, d.d);
          }
          if (raw !== null && raw !== '' && !normalized) rowIssue('DATE_NOT_NORMALIZED', '日期原值已保留，格式或含义需人工确认', label, true);
          return { raw, numberFormat, date1904, isoDate: normalized };
        };
        const hNo = text('公司订单号', true)?.toUpperCase() ?? '';
        if (!/^H[A-Z0-9._/-]{1,99}$/.test(hNo)) { rowIssue('INVALID_H_NO', '公司订单号必须是以H开头的有效文本标识（最多100字符）', '公司订单号'); continue; }
        const rawQuantity = plainValue(at('订单量'));
        let quantity: string | null = null;
        if (rawQuantity !== null && rawQuantity !== '') {
          const candidate = typeof rawQuantity === 'number' || typeof rawQuantity === 'string' ? String(rawQuantity).trim() : '';
          if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(candidate)) rowIssue('INVALID_QUANTITY', '订单量应为非负十进制数，最多14位整数及4位小数；不自动换算或四舍五入', '订单量');
          else { const [whole, decimals] = candidate.split('.'); quantity = `${whole.replace(/^0+(?=\d)/, '')}${decimals ? `.${decimals}` : ''}`; }
        } else rowIssue('MISSING_QUANTITY', '订单量缺失，原明细已保留待确认', '订单量', true);
        const unit = text('单位');
        if (!unit) rowIssue('MISSING_UNIT', '数量单位缺失，不能自动补单位或当卷数', '单位');
        else if (!['米', '公斤', '码'].includes(unit)) rowIssue('UNSUPPORTED_UNIT', '数量单位未支持，请确认映射后处理；不自动换算', '单位');
        const line: VcansImportLine = {
          sourceSheet: name, sourceRow, hNo,
          customerOrderNo: text('客户订单号', true), customerName: text('客户'), productName: text('品名'),
          productCode: text('物料号', true), customerProductCode: text('客户料号', true),
          specification: text('规格'), customerSpecification: text('客户规格'), color: text('颜色'),
          quantity, quantityUnit: unit, salespersonName: text('业务员'), orderType: text('类型'),
          postProcess: text('后道工艺'), processRequirements: text('工艺要求'), category: text('品类'),
          sourceBatchNo: text('批号') === '.' ? null : text('批号'),
          sourceDyeingOrderNo: text('染整单号', true), sourceSequence: text('序号'), sourceLineId: text('批次序号', true),
          orderDate: date('下单日期'), totalDeliveryDate: date('总交期'), detailDeliveryDate: date('明细交期'),
        };
        if (!line.productCode) rowIssue('MISSING_PRODUCT_CODE', '物料号缺失，原明细已保留', '物料号', true);
        if (!line.customerOrderNo) rowIssue('MISSING_CUSTOMER_ORDER_NO', '客户订单号缺失，不使用H号代填', '客户订单号', true);
        if (!line.salespersonName) rowIssue('MISSING_SALESPERSON', '业务员缺失，需在授权映射环节处理', '业务员', true);
        const signature = JSON.stringify(rawCells.map((cell) => [cell.header ?? cell.column, cell.inheritedFrom ? plainValue(sheet[cell.inheritedFrom]) : cell.value]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
        if (signatures.has(signature)) rowIssue('DUPLICATE_DETAIL', '发现完全相同的源明细，不自动去重或重复导入', '公司订单号');
        signatures.add(signature);
        if (line.sourceLineId) {
          if (sourceLineIds.has(line.sourceLineId)) rowIssue('REPEATED_SOURCE_LINE_ID', '源批次序号重复，仅保留为来源参考，不能作为永久明细ID', '批次序号', true);
          sourceLineIds.add(line.sourceLineId);
        }
        const lines = groups.get(hNo) ?? [];
        lines.push(line); groups.set(hNo, lines);
        requireLimit(groups.size <= L.groups && lines.length <= L.linesPerGroup, '订单组或同订单明细数量超出限制');
      }
    }
    result.groups = [...groups].map(([hNo, lines]) => ({ hNo, lines }));
    if (!result.rows.length && !result.errors.length) fail('EMPTY_TABLE', '没有可解析的订单明细');
    for (const group of result.groups) for (const field of ['customerName', 'salespersonName'] as const) {
      if (new Set(group.lines.map((line) => line[field])).size > 1) issue(result.warnings, 'GROUP_FIELD_VARIATION', '同H客户或业务员不同，需逐明细核对，不能推断部门', group.lines[0].sourceSheet, group.lines[0].sourceRow);
    }
    result.canImport = !result.errors.length && !!result.groups.length;
  } catch (error) {
    // Never echo a library exception: it may contain workbook values, formula text or paths.
    result.errors.push(error instanceof ParseFailure ? { code: error.code, message: error.message } : { code: 'INVALID_FILE', message: '文件无法完整解析，请提供有效且未加密的Excel导出表' });
    result.rows = []; result.groups = []; result.canImport = false;
  }
  return result;
}

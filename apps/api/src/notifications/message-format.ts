/**
 * 订阅消息字段格式化。微信对不同类型字段有长度和字符限制：
 * thing ≤20 字；name ≤10 字；phrase ≤5 个汉字；character_string ≤32 位字母数字符号；time 为日期时间。
 */
export function formatField(templateKey: string, value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  if (value instanceof Date) return formatTime(value);
  const v = String(value).replace(/\s+/g, ' ').trim();
  if (templateKey.startsWith('time') || templateKey.startsWith('date')) return v;
  if (templateKey.startsWith('thing')) return truncate(v, 20);
  if (templateKey.startsWith('name')) return truncate(v, 10);
  if (templateKey.startsWith('phrase')) return truncate(v.replace(/[^一-龥]/g, ''), 5) || '-';
  if (templateKey.startsWith('character_string')) return truncate(v.replace(/[^\x21-\x7e]/g, ''), 32) || '-';
  if (templateKey.startsWith('number')) return v.replace(/[^\d.]/g, '').slice(0, 32) || '0';
  return truncate(v, 20);
}

function truncate(s: string, n: number) {
  const chars = [...s];
  return chars.length <= n ? s : chars.slice(0, n - 1).join('') + '…';
}

export function formatTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 按 {模板字段: 业务字段} 映射生成 data */
export function buildTemplateData(
  mapping: Record<string, string>,
  values: Record<string, string | Date | null | undefined>,
): Record<string, { value: string }> {
  const data: Record<string, { value: string }> = {};
  for (const [tplKey, bizKey] of Object.entries(mapping)) {
    data[tplKey] = { value: formatField(tplKey, values[bizKey]) };
  }
  return data;
}

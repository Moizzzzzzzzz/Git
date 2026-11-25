import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDate(v: string | Date | null | undefined, withTime = true): string {
  if (!v) return '-';
  const d = typeof v === 'string' ? new Date(v) : v;
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { year: 'numeric', month: '2-digit', day: '2-digit' };
  return d.toLocaleString('zh-CN', { ...opts, timeZone: 'Asia/Shanghai' });
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  return Number(v.toFixed(digits)).toString();
}

/** 把空字符串转为 null，数字字符串转为 number */
export function toNumOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

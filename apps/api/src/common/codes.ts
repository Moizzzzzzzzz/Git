import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/** Crockford Base32（去掉 I L O U，避免抄写混淆） */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCode(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 业务编号：前缀 + yyyyMMdd（上海时区）+ 随机串 */
export function businessNo(prefix: string, randomLength = 4, now = new Date()): string {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .replace(/-/g, '');
  return `${prefix}${d}-${randomCode(randomLength)}`;
}

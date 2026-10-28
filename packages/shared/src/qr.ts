/** 二维码内容：{QR_BASE_URL}/r/{qrCode}。qrCode 为 10 位 Crockford Base32。 */
export const QR_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** 从扫码结果中解析布卷二维码标识；兼容直接扫描标识本身 */
export function parseRollQr(raw: string): string | null {
  const text = raw.trim();
  const m = text.match(/\/r\/([0-9A-Za-z]{10})(?:[/?#].*)?$/);
  const candidate = (m ? m[1] : text).toUpperCase();
  return QR_CODE_PATTERN.test(candidate) ? candidate : null;
}

export function buildRollQrContent(baseUrl: string, qrCode: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/r/${qrCode}`;
}

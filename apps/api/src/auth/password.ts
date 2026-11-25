import { hash, verify } from '@node-rs/argon2';

// Argon2id，参数兼顾 4GB 服务器内存
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** 用户不存在时也做一次哈希校验，避免通过响应时间探测用户名 */
let dummy: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('fabricqc-dummy-password-0');
  await verifyPassword(await dummy, password);
}

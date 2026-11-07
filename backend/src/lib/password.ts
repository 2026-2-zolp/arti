/**
 * 비밀번호 해시 (Node.js 내장 scrypt) 와 토큰 유틸
 * 저장 형식: scrypt$<salt hex>$<hash hex>
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** 프론트 회원가입 규칙과 동일: 8자 이상, 영문과 숫자 포함 */
export function isValidPassword(pw: string): boolean {
  return pw.length >= 8 && pw.length <= 128 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

/** 추측 불가능한 무작위 토큰 (세션·비밀번호 재설정용) */
export const newToken = () => randomBytes(32).toString('base64url');

/** DB에는 토큰 원문 대신 해시를 저장한다 (DB가 유출돼도 토큰을 바로 쓸 수 없도록) */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const newId = (prefix: string) => `${prefix}-${randomBytes(6).toString('hex')}`;

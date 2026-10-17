/** 라벨 + 입력창 + 오류 메시지를 묶은 폼 필드 */
import type { InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
}

export function Field({ label, error, hint, id, ...rest }: Props) {
  const inputId = id ?? `f-${label}`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} aria-invalid={!!error} {...rest} />
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
/** 비밀번호 규칙: 8자 이상, 영문과 숫자 포함 */
export const isValidPassword = (v: string) => v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);

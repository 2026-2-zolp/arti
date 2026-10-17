/** 한글 마지막 글자에 받침이 있는지 판별 (조사 와/과, 을/를 등을 고르기 위해 사용) */
export function hasBatchim(word: string): boolean {
  const last = word.trim().replace(/['"’”)\]]+$/, '').slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false; // 한글 음절이 아니면 받침 없음으로 처리
  return (code - 0xac00) % 28 !== 0;
}

/** 단어 뒤에 맞는 조사를 붙인다. 예: josa('색감', '와', '과') → '색감과' */
export function josa(word: string, withoutBatchim: string, withBatchim: string): string {
  return word + (hasBatchim(word) ? withBatchim : withoutBatchim);
}

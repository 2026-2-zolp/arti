/** 한글 받침 여부에 따라 조사 선택. withJosa('색채', '와/과') → '색채와' */
export function withJosa(word: string, pair: '와/과' | '을/를' | '이/가' | '은/는') {
  const [noFinal, hasFinal] = pair.split('/');
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}${noFinal}`;
  return `${word}${(last - 0xac00) % 28 > 0 ? hasFinal : noFinal}`;
}

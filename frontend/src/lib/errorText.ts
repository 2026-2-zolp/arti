/**
 * 오류 안내 카드에 붙일 서버 오류 문구를 고른다.
 * 서버가 이유를 주지 않을 때 쓰는 기본 문구("요청을 처리하지 못했어요.")는
 * 카드의 "○○을 불러오지 못했어요." 문장과 뜻이 겹쳐서 화면에 붙이지 않는다.
 */
export const GENERIC_ERROR = '요청을 처리하지 못했어요.';

/** 카드 문장 뒤에 붙일 오류 설명. 기본 문구이거나 비어 있으면 빈 문자열. */
export function errorDetail(message: string | null | undefined): string {
  const text = message?.trim();
  return !text || text === GENERIC_ERROR ? '' : ` ${text}`;
}

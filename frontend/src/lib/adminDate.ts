/**
 * 관리자 화면의 날짜·시각 표시.
 * 서버는 UTC(예: 2026-11-11T13:02:45.336585+00:00)로 주므로 한국 시각으로 바꿔 "2026-11-11 22:02"로 보여 준다.
 */
const KST_DATE_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "YYYY-MM-DD HH:mm"(한국 시각). 값이 없으면 "-", 날짜로 읽을 수 없으면 받은 값 그대로. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : KST_DATE_TIME.format(date);
}

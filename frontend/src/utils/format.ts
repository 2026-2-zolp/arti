export function formatDate(iso: string, sep = '.') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return [y, m, day].join(sep);
}

export function formatMonthDay(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** 2026-10-01 ~ 2026-12-31 → 2026.10.01 ~ 12.31 */
export function formatPeriod(start: string, end: string) {
  const s = formatDate(start);
  const e = formatDate(end);
  return s.slice(0, 4) === e.slice(0, 4) ? `${s} ~ ${e.slice(5)}` : `${s} ~ ${e}`;
}

export function todayISODate() {
  return formatDate(new Date().toISOString(), '-');
}

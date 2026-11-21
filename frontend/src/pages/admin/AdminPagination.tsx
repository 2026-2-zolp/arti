export const ADMIN_PAGE_SIZE = 10;

export function adminPage(rows: number, requested: number) {
  const pages = Math.max(1, Math.ceil(rows / ADMIN_PAGE_SIZE));
  const page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  return { page, pages, offset: (page - 1) * ADMIN_PAGE_SIZE };
}

export function AdminPagination({ page, pages, total, onChange }: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="a-pagination" aria-label="목록 페이지">
      <span className="muted small" aria-live="polite">{page} / {pages} 페이지 · {total}건</span>
      <div className="a-actions">
        <button className="a-btn sm" type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>이전 페이지</button>
        <button className="a-btn sm" type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}>다음 페이지</button>
      </div>
    </nav>
  );
}

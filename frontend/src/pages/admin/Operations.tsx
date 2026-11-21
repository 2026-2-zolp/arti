import { useState } from 'react';
import { api } from '../../api/client';
import { formatDateTime } from '../../lib/adminDate';
import { useAsync } from '../../lib/useAsync';
import { PageHead } from './AdminLayout';
import { AdminPagination } from './AdminPagination';

const analysisLabel = { summary: '쉬운 요약', guide: '관람가이드', tag: '취향 태그', emotion: '감정 분석' };
const actionLabel: Record<string, string> = {
  ai_settings_save: 'OpenAI 연결 설정 저장',
  exhibition_save: '전시 저장', artwork_save: '작품 저장', artwork_image: '도판 변경', docent_source_review: '도슨트 소장처 근거 검수',
  exhibition_delete: '전시 삭제', artwork_delete: '작품 삭제',
  floor_plan: '도면 변경', exhibition_poster: '전시 포스터 변경', navigation_layout: '지도 이동 구조 저장',
  artwork_analysis: '작품 AI 분석', discard_proposal: 'AI 제안 폐기',
  confirm_proposals: 'AI 제안 일괄 확정', docent_question: '도슨트 질문',
  docent_explanation: '도슨트 해설', docent_audio: '도슨트 답변 음성', receipt_interpretation: '영수증 해석',
};

const emptyFilters = { action: '', status: '', start: '', end: '' };

export default function Operations() {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(() => {
    const query = new URLSearchParams({ page: String(page) });
    if (errorsOnly) query.set('errors', '1');
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    return api.adminOperationEvents(query);
  }, [page, errorsOnly, filters], true);
  const rows = data?.rows ?? [];
  const changeDraft = (key: keyof typeof emptyFilters, value: string) => setDraft({ ...draft, [key]: value });
  return (
    <>
      <PageHead title="운영 로그" desc="응답 코드·작업·시각으로 운영 기록을 찾습니다. 시각은 한국 기준이에요."
        actions={<button className="a-btn" type="button" onClick={reload} disabled={loading}>다시 조회</button>} />
      <form className="a-filters a-log-filters" onSubmit={(event) => {
        event.preventDefault();
        setPage(1);
        setFilters({ ...draft });
      }}>
        <label className="a-field">응답 코드
          <input type="number" min={100} max={599} step={1} inputMode="numeric" placeholder="전체" value={draft.status}
            onChange={event => changeDraft('status', event.target.value)} />
        </label>
        <div className="a-field">
          <label htmlFor="operation-action">작업</label>
          <select id="operation-action" value={draft.action} onChange={event => changeDraft('action', event.target.value)}>
            <option value="">전체 작업</option>
            {Object.entries(actionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <label className="a-field">시작 시각
          <input type="datetime-local" value={draft.start} max={draft.end || undefined}
            onChange={event => changeDraft('start', event.target.value)} />
        </label>
        <label className="a-field">종료 시각
          <input type="datetime-local" value={draft.end} min={draft.start || undefined}
            onChange={event => changeDraft('end', event.target.value)} />
        </label>
        <label className="a-log-errors"><input type="checkbox" checked={errorsOnly} onChange={event => {
          setPage(1);
          setErrorsOnly(event.target.checked);
        }} /> 오류만 보기</label>
        <button className="a-btn primary" type="submit">적용</button>
        <button className="a-btn" type="button" onClick={() => {
          setPage(1);
          setDraft(emptyFilters);
          setFilters({ ...emptyFilters });
          setErrorsOnly(false);
        }}>초기화</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">불러오는 중…</p>}
      {data && (
        <>
          <div className="a-card" aria-busy={loading}>
            <table className="a-table">
              <thead><tr><th>시각</th><th>작업</th><th>응답 코드</th><th>부분 실패</th><th>요청 ID</th></tr></thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.requestId}>
                    <td className="nowrap">{formatDateTime(row.occurredAt)}</td>
                    <td>{actionLabel[row.action] ?? row.action}</td>
                    <td>{row.status}</td>
                    <td>{row.analysisFailures?.map(({ field, code }) => `${analysisLabel[field]} · ${code}`).join(' / ') ?? '—'}</td>
                    <td><code>{row.requestId}</code></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5}>{errorsOnly ? '조건에 맞는 오류가 없어요.' : '조건에 맞는 운영 이벤트가 없어요.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <AdminPagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
        </>
      )}
    </>
  );
}

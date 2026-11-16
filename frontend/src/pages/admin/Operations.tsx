import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OperationsReport } from '../../api/client';
import { formatDateTime } from '../../lib/adminDate';
import { useAsync } from '../../lib/useAsync';
import { PageHead } from './AdminLayout';

const configurationLabel = { configured: '설정됨', disabled: '꺼짐', invalid: '설정 확인 필요' };
const actionLabel: Record<string, string> = {
  exhibition_save: '전시 저장', artwork_save: '작품 저장', artwork_image: '도판 변경',
  floor_plan: '도면 변경', artwork_analysis: '작품 AI 분석', discard_proposal: 'AI 제안 폐기',
  confirm_proposals: 'AI 제안 일괄 확정', docent_question: '도슨트 질문',
  docent_explanation: '도슨트 해설', receipt_interpretation: '영수증 해석',
};

function OperationsSummary({ report }: { report: OperationsReport }) {
  return (
    <>
      <p>도슨트 {configurationLabel[report.configuration.docent]} · 요약·가이드 {configurationLabel[report.draftConfiguration]} · 태그·감정 분석 {configurationLabel[report.configuration.analysis]}</p>
      <p>오늘 도슨트 요청 {report.today.docentRequests}건 · 관리자 AI 분석 {report.today.analysisRequests}건 · AI 요청 오류 {report.today.aiErrors}건</p>
    </>
  );
}

export function OperationsOverview() {
  const { data, loading, error } = useAsync(() => api.adminOperations('summary'), []);
  return (
    <>
      <h2 className="a-section-title">AI 운영 현황</h2>
      <div className="a-card pad stack gap-10">
        {error ? <p role="status">운영 현황을 불러오지 못했어요.</p>
          : loading || !data ? <p role="status">불러오는 중…</p> : <OperationsSummary report={data} />}
        <Link to="/admin/operations">운영 로그 보기</Link>
      </div>
    </>
  );
}

export default function Operations() {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.adminOperations(errorsOnly ? 'errors' : undefined), [errorsOnly]);
  const rows = data?.recent ?? [];
  return (
    <>
      <PageHead title="운영 로그" desc="오늘 집계는 한국 시각 기준입니다. 아래 표에는 최근 운영 이벤트 50건을 표시합니다."
        actions={<button className="a-btn" type="button" onClick={reload} disabled={loading}>다시 조회</button>} />
      <section className="a-card pad stack gap-10" aria-label="AI 운영 현황">
        {data && <OperationsSummary report={data} />}
        <p className="muted small">설정 상태는 서버 구성 기준입니다. 실제 요청 결과는 아래 로그에서 확인할 수 있어요.</p>
        <label><input type="checkbox" checked={errorsOnly} onChange={event => setErrorsOnly(event.target.checked)} /> 오류만 보기</label>
      </section>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">불러오는 중…</p>}
      {data && (
        <>
          <div className="a-card">
            <table className="a-table">
              <thead><tr><th>시각</th><th>작업</th><th>응답 코드</th><th>요청 ID</th></tr></thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.requestId}>
                    <td className="nowrap">{formatDateTime(row.occurredAt)}</td>
                    <td>{actionLabel[row.action] ?? row.action}</td>
                    <td>{row.status}</td>
                    <td><code>{row.requestId}</code></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4}>{errorsOnly ? '최근 로그에 오류가 없어요.' : '아직 기록된 운영 이벤트가 없어요.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

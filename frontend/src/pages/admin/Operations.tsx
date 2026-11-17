import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OperationsReport } from '../../api/client';
import { formatDateTime } from '../../lib/adminDate';
import { useAsync } from '../../lib/useAsync';
import { PageHead } from './AdminLayout';

const configurationLabel = { configured: '설정됨', disabled: '꺼짐', invalid: '설정 확인 필요' };
const analysisLabel = { summary: '쉬운 요약', guide: '관람가이드', tag: '취향 태그', emotion: '감정 분석' };
const textTaskLabel: Record<string, string> = {
  summary: '쉬운 요약', guide: '관람가이드', guide_review: '가이드 근거 검수',
  answer: '도슨트 질문', explanation: '쉬운 해설', interpret: '영수증 해석',
};
const actionLabel: Record<string, string> = {
  exhibition_save: '전시 저장', artwork_save: '작품 저장', artwork_image: '도판 변경',
  floor_plan: '도면 변경', navigation_layout: '지도 이동 구조 저장', artwork_analysis: '작품 AI 분석', discard_proposal: 'AI 제안 폐기',
  confirm_proposals: 'AI 제안 일괄 확정', docent_question: '도슨트 질문',
  docent_explanation: '도슨트 해설', receipt_interpretation: '영수증 해석',
};

function OperationsSummary({ report }: { report: OperationsReport }) {
  const usage = report.textModelUsage;
  return (
    <>
      <p>도슨트 {configurationLabel[report.configuration.docent]} · 요약·가이드 {configurationLabel[report.draftConfiguration]} · 태그·감정 분석 {configurationLabel[report.configuration.analysis]}</p>
      <p>오늘 도슨트 요청 {report.today.docentRequests}건 · 관리자 AI 분석 {report.today.analysisRequests}건 · AI 요청 오류 {report.today.aiErrors}건 · 분석 부분 실패 {report.today.analysisPartialFailures}건</p>
      {usage && <p>텍스트 모델 호출 시도 {usage.attempts}건 · {usage.inputTokens === null || usage.outputTokens === null
        ? '토큰 미수집' : `입력 ${usage.inputTokens.toLocaleString('ko-KR')} · 출력 ${usage.outputTokens.toLocaleString('ko-KR')} 토큰`}
        {usage.missing > 0 && ` · 토큰 미수집 요청 ${usage.missing}건`}</p>}
    </>
  );
}

function TextModelUsageTable({ rows }: { rows: NonNullable<OperationsReport['textModelUsageByTaskModel']> }) {
  const tokens = (value: number | null) => value === null ? '미수집' : value.toLocaleString('ko-KR');
  return (
    <section className="a-card pad stack gap-10" aria-label="작업·모델별 토큰 사용량">
      <h2>작업·모델별 토큰 사용량</h2>
      <p className="muted small">캐시 입력은 전체 입력에 포함돼요. 집계를 시작한 뒤의 요청을 표시해요.</p>
      {rows.length ? (
        <table className="a-table">
          <thead><tr><th>작업</th><th>모델</th><th>호출 시도</th><th>입력 토큰</th><th>출력 토큰</th><th>캐시 입력</th><th>미수집</th></tr></thead>
          <tbody>{rows.map(row => (
            <tr key={JSON.stringify([row.task, row.model])}>
              <td>{textTaskLabel[row.task] ?? row.task}</td><td>{row.model || '모델명 미식별'}</td><td>{row.attempts}</td>
              <td>{tokens(row.inputTokens)}</td><td>{tokens(row.outputTokens)}</td><td>{tokens(row.cachedInputTokens)}</td>
              <td>토큰 {row.missing}건 · 캐시 {row.cacheMissing}건</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p>오늘 집계한 모델 사용량이 없어요.</p>}
    </section>
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
      {data?.textModelUsageByTaskModel && <TextModelUsageTable rows={data.textModelUsageByTaskModel} />}
      {data && (
        <>
          <div className="a-card">
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
                {!rows.length && <tr><td colSpan={5}>{errorsOnly ? '최근 로그에 오류가 없어요.' : '아직 기록된 운영 이벤트가 없어요.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

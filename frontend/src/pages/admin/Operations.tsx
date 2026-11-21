import { useState } from 'react';
import { api } from '../../api/client';
import { formatDateTime } from '../../lib/adminDate';
import { useAsync } from '../../lib/useAsync';
import { PageHead } from './AdminLayout';

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

export default function Operations() {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.adminOperations(errorsOnly ? 'errors' : undefined), [errorsOnly]);
  const rows = data?.recent ?? [];
  return (
    <>
      <PageHead title="운영 로그" desc="최근 운영 이벤트 50건을 한국 시각으로 표시합니다."
        actions={<button className="a-btn" type="button" onClick={reload} disabled={loading}>다시 조회</button>} />
      <div className="a-log-filter">
        <label><input type="checkbox" checked={errorsOnly} onChange={event => setErrorsOnly(event.target.checked)} /> 오류만 보기</label>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">불러오는 중…</p>}
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

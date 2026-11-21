import { Link } from 'react-router-dom';
import { api, type OperationsReport } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { PageHead } from './AdminLayout';
import OpenAISettingsPanel from './OpenAISettings';

const configurationLabel = { configured: '설정됨', disabled: '꺼짐', invalid: '설정 확인 필요' };
const voiceIntentLabel = { play: '듣기 요청', prepare: '미리 준비' };
const textTaskLabel: Record<string, string> = {
  summary: '쉬운 요약', guide: '관람가이드', guide_review: '가이드 근거 검수',
  answer: '도슨트 질문', explanation: '쉬운 해설', interpret: '영수증 해석',
};
function TextModelUsageTable({ rows }: { rows: NonNullable<OperationsReport['textModelUsageByTaskModel']> }) {
  const tokens = (value: number | null) => value === null ? '미수집' : value.toLocaleString('ko-KR');
  return (
    <section className="a-card pad stack gap-10" aria-label="작업·모델별 토큰 사용량">
      <h2>작업·모델별 토큰 사용량</h2>
      <p className="muted small">캐시 입력은 전체 입력에 포함돼요. 추정 비용은 단가와 사용량을 확인할 수 있는 호출만 집계해요.</p>
      {rows.length ? (
        <div className="a-ai-table"><table className="a-table">
          <thead><tr><th>작업</th><th>모델</th><th>호출 시도</th><th>입력 토큰</th><th>출력 토큰</th><th>캐시 입력</th><th>미수집</th><th>추정 비용</th></tr></thead>
          <tbody>{rows.map(row => (
            <tr key={JSON.stringify([row.task, row.model])}>
              <td>{textTaskLabel[row.task] ?? row.task}</td><td>{row.model || '모델명 미식별'}</td><td>{row.attempts}</td>
              <td>{tokens(row.inputTokens)}</td><td>{tokens(row.outputTokens)}</td><td>{tokens(row.cachedInputTokens)}</td>
              <td>토큰 {row.missing}건 · 캐시 {row.cacheMissing}건</td>
              <td>{row.estimatedCostUsd === undefined ? '미산정' : `USD ${row.estimatedCostUsd} · ${row.priced}/${row.attempts}건`}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p>오늘 집계한 모델 사용량이 없어요.</p>}
    </section>
  );
}

function VoiceModelUsageTable({ rows }: { rows: NonNullable<OperationsReport['voiceModelUsageByIntent']> }) {
  const tokens = (value: number | null) => value === null ? '미수집' : value.toLocaleString('ko-KR');
  return (
    <section className="a-card pad stack gap-10" aria-label="음성 모델 사용량">
      <h2>음성 모델 사용량</h2>
      {rows.length ? (
        <>
          <p className="muted small">제공자가 반환한 토큰을 합산해요. 추정 비용에 단가를 적용한 호출 수를 함께 표시해요.</p>
          <div className="a-ai-table"><table className="a-table">
            <thead><tr><th>요청 목적</th><th>모델</th><th>토큰 수집</th><th>입력 토큰</th><th>캐시 입력</th><th>출력 토큰</th><th>출력 중 음성</th><th>추정 비용</th></tr></thead>
            <tbody>{rows.map(row => (
              <tr key={JSON.stringify([row.intent, row.model])}>
                <td>{voiceIntentLabel[row.intent]}</td><td>{row.model}</td><td>{row.measured}/{row.attempts}건</td>
                <td>{tokens(row.inputTokens)}</td><td>{tokens(row.cachedInputTokens)}</td>
                <td>{tokens(row.outputTokens)}</td><td>{tokens(row.outputAudioTokens)}</td>
                <td>{row.estimatedCostUsd === null ? '미수집' : `USD ${row.estimatedCostUsd} · ${row.priced}/${row.attempts}건`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      ) : <p>오늘 집계한 음성 모델 호출이 없어요.</p>}
    </section>
  );
}

function AiActivity({ report }: { report: OperationsReport }) {
  const metrics = [
    { label: '도슨트 질문', count: report.today.docentRequests },
    { label: '관리자 분석 요청', count: report.today.analysisRequests },
    { label: '텍스트 모델 호출 시도', count: report.textModelUsage?.attempts },
    { label: 'AI 요청 오류', count: report.today.aiErrors, warning: true },
    { label: '분석 부분 실패', count: report.today.analysisPartialFailures, warning: true },
  ];
  const maximum = Math.max(1, ...metrics.map(({ count }) => count ?? 0));

  return (
    <>
      <ul className="a-ai-activity" aria-label="오늘 AI 요청 집계">
        {metrics.map(({ label, count, warning }) => (
          <li key={label} className={warning ? 'a-ai-warning' : undefined}>
            <span>{label}</span>
            <strong>{count === undefined ? '미수집' : `${count.toLocaleString('ko-KR')}건`}</strong>
            <div className="a-ai-bar" aria-hidden="true">
              <span style={{ width: `${((count ?? 0) / maximum) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">한국 시각 기준 · 요청 한 건에서 모델을 여러 번 호출할 수 있어요.</p>
    </>
  );
}

export function AiOverview() {
  const { data, loading, error } = useAsync(() => api.adminOperations('summary'), []);
  return (
    <>
      <h2 className="a-section-title">AI 운영 현황</h2>
      <section className="a-card pad stack gap-12" aria-label="오늘 AI 운영 현황">
        {error ? <p role="status">운영 현황을 불러오지 못했어요.</p>
          : loading || !data ? <p role="status">불러오는 중…</p> : <AiActivity report={data} />}
        <Link className="a-ai-details" to="/admin/ai">AI 관리 자세히 보기</Link>
      </section>
    </>
  );
}

export default function AiManagement() {
  const { data, loading, error, reload } = useAsync(() => api.adminOperations(), []);
  const usage = data?.textModelUsage;
  return (
    <div className="stack gap-16">
      <PageHead title="AI 관리" desc="AI 연결을 설정하고 오늘의 모델 사용량과 추정 비용을 확인합니다."
        actions={<button className="a-btn" type="button" onClick={reload} disabled={loading}>다시 조회</button>} />
      <OpenAISettingsPanel refreshUsage={reload} />
      <section className="a-card pad stack gap-12" aria-label="AI 운영 현황">
        <h2>오늘 AI 운영 현황</h2>
        {error ? <p role="alert">{error}</p> : loading || !data ? <p role="status">불러오는 중…</p> : (
          <>
            <AiActivity report={data} />
            <dl className="a-ai-config">
              <div><dt>도슨트</dt><dd>{configurationLabel[data.configuration.docent]}</dd></div>
              <div><dt>요약·가이드</dt><dd>{configurationLabel[data.draftConfiguration]}</dd></div>
              <div><dt>태그·감정 분석</dt><dd>{configurationLabel[data.configuration.analysis]}</dd></div>
            </dl>
            {usage && <p>텍스트 모델 호출 시도 {usage.attempts}건 · {usage.inputTokens === null || usage.outputTokens === null
              ? '토큰 미수집' : `입력 ${usage.inputTokens.toLocaleString('ko-KR')} · 출력 ${usage.outputTokens.toLocaleString('ko-KR')} 토큰`}
              {usage.missing > 0 && ` · 토큰 미수집 요청 ${usage.missing}건`}</p>}
          </>
        )}
      </section>
      {data?.textModelUsageByTaskModel && <TextModelUsageTable rows={data.textModelUsageByTaskModel} />}
      {data?.voiceModelUsageByIntent && <VoiceModelUsageTable rows={data.voiceModelUsageByIntent} />}
    </div>
  );
}

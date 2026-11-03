/** A-02 관리자 대시보드 — 전시·작품·위치·검수 상태 요약, 전시별 취향 태그 분포 */
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { TASTE_LABEL, TAG_KEYS } from '../../data/mock';
import { useAsync } from '../../lib/useAsync';
import { EX_STATUS_LABEL, PageHead, REVIEW_LABEL } from './AdminLayout';

export default function A02Dashboard() {
  const { data } = useAsync(async () => {
    const [exs, works] = await Promise.all([api.listExhibitions(), api.listArtworks()]);
    const shown = exs.filter((e) => e.status !== 'closed');
    // 백엔드가 예전 버전이라 태그 분포 API가 없으면 표만 빼고 나머지는 보여 준다
    const coverage = await Promise.all(shown.map((e) => api.tagCoverage(e.id).catch(() => null)));
    return [exs, works, shown.flatMap((e, i) => (coverage[i] ? [{ ex: e, cov: coverage[i]! }] : []))] as const;
  }, []);
  if (!data) return <PageHead title="대시보드" desc="불러오는 중…" />;
  const [exs, works, coverage] = data;

  const running = exs.filter((e) => e.status === 'running');
  const approved = works.filter((w) => w.reviewStatus === 'approved').length;
  const positioned = works.filter((w) => w.position).length;
  const waiting = works.filter((w) => w.reviewStatus !== 'approved').length;

  const recent = [
    ...works.map((w) => ({ kind: '작품', name: w.title, status: REVIEW_LABEL[w.reviewStatus], date: w.updatedAt, to: `/admin/artworks/${w.id}` })),
    ...exs.map((e) => ({ kind: '전시', name: e.title, status: EX_STATUS_LABEL[e.status], date: e.startDate, to: '/admin/exhibitions' })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  return (
    <>
      <PageHead title="대시보드" desc="등록된 전시와 작품, 데이터 검수 상태를 한눈에 확인합니다." />
      <div className="stat-grid">
        <Stat label="운영 전시" value={running.length} sub={running[0] ? '현재 MVP 대상' : '운영 중인 전시 없음'} to="/admin/exhibitions" />
        <Stat label="등록 작품" value={works.length} sub={`검수 완료 ${approved}`} to="/admin/artworks" />
        <Stat label="위치 등록" value={positioned} sub={`미등록 ${works.length - positioned}`} to="/admin/map" />
        <Stat label="검수 대기" value={waiting} sub="출처 확인 필요" to="/admin/artworks?review=todo" warn={waiting > 0} />
      </div>

      <h2 className="a-section-title">전시별 취향 태그 분포</h2>
      <p className="muted small" style={{ margin: '-8px 0 12px' }}>
        태그마다 사용자 추천에 쓸 수 있는 작품 수예요(검수 완료 · 위치 등록 · 태그 0.5 이상). <b>0</b>인 태그를 고른 관람객에게는
        "이 전시에는 없는 취향"이라고 안내하고 다음 순위 취향으로 대신 추천해요.
      </p>
      <div className="a-card">
        <table className="a-table coverage-table">
          <thead>
            <tr>
              <th>전시</th>
              {TAG_KEYS.map((t) => (
                <th key={t}>{TASTE_LABEL[t]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverage.map(({ ex, cov }) => (
              <tr key={ex.id}>
                <td>
                  {ex.title} <span className="muted small">({EX_STATUS_LABEL[ex.status]})</span>
                </td>
                {TAG_KEYS.map((t) => (
                  <td key={t} className={cov[t] === 0 ? 'zero' : ''}>
                    {cov[t]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="a-section-title">최근 데이터 상태</h2>
      <div className="a-card">
        <table className="a-table">
          <thead>
            <tr>
              <th>구분</th>
              <th>이름</th>
              <th>상태</th>
              <th>수정일</th>
              <th>담당</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.kind + r.name}>
                <td>{r.kind}</td>
                <td>
                  <Link to={r.to}>{r.name}</Link>
                </td>
                <td>{r.status}</td>
                <td>{r.date.slice(5).replace('-', '/')}</td>
                <td>관리자</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value, sub, to, warn }: { label: string; value: number; sub: string; to: string; warn?: boolean }) {
  return (
    <Link to={to} className={`stat ${warn ? 'warn' : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-sub">{sub}</span>
    </Link>
  );
}

/** A-02 관리자 대시보드 — 전시·작품·위치·검수 상태 요약 */
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { EX_STATUS_LABEL, PageHead, REVIEW_LABEL } from './AdminLayout';

export default function A02Dashboard() {
  const { data } = useAsync(() => Promise.all([api.listExhibitions(), api.listArtworks()]), []);
  if (!data) return <PageHead title="대시보드" desc="불러오는 중…" />;
  const [exs, works] = data;

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

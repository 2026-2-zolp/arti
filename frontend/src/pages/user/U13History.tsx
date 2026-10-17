/** U-13 관람기록 — 관람기록 URL(/history) 직접 진입, 미로그인 시 U-03 인증 후 복귀 */
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { Icon } from '../../components/Icon';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { useVisit } from '../../store/VisitContext';
import { formatDate } from './U12Receipt';

export default function U13History() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const user = state.user;
  const { data: visits, loading } = useAsync(
    () => (user ? api.listVisits(user.id) : Promise.resolve([])),
    [user?.id],
  );

  if (!user) return <Navigate to="/login?redirect=/history" replace />;

  const logout = () => {
    api.logout(); // 서버 세션 종료 (실패해도 화면은 바로 로그아웃)
    dispatch({ type: 'logout' });
    navigate('/', { replace: true });
  };

  return (
    <MobileShell
      screenId="U-13"
      title="관람기록"
      right={
        <button className="text-btn" onClick={logout}>
          로그아웃
        </button>
      }
    >
      <Lead title={`${user.nickname || '나'}의 관람기록`} desc="지난 관람의 아트 영수증을 다시 확인할 수 있어요." />

      {loading && <Spinner />}
      {visits && visits.length === 0 && (
        <div className="empty">
          <p>아직 저장된 관람기록이 없어요.</p>
          <Link className="btn outline" to="/">
            관람 시작하기
          </Link>
        </div>
      )}

      <ul className="history-list">
        {visits?.map((v) => (
          <li key={v.id}>
            <button className="history-card" onClick={() => navigate(`/receipt/${v.id}`)}>
              <div className="history-top">
                <span className="muted small">
                  <Icon name="pin" size={15} /> {v.venue}
                </span>
                <span className="muted small">{formatDate(v.date)}</span>
              </div>
              <strong>{v.exhibitionTitle}</strong>
              <div className="history-stats">
                <span>작품 {v.viewedArtworkIds.length}점</span>
                <span>관람 {v.durationMin}분</span>
                <span>👍 {Object.values(v.reactions).filter((r) => r === 'like').length}</span>
              </div>
              <span className="history-cta">
                <Icon name="receipt" size={16} /> 아트 영수증 보기 <Icon name="chevron" size={16} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </MobileShell>
  );
}

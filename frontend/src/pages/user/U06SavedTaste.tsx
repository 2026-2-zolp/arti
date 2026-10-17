/** U-06 저장 취향 확인 — 로그인 사용자의 기존 취향을 그대로 쓰거나 수정 */
import { Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { TASTE_LABEL } from '../../data/mock';
import { useVisit } from '../../store/VisitContext';

export default function U06SavedTaste() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const user = state.user;

  if (!user) return <Navigate to="/login?redirect=/taste/saved" replace />;

  const hasTastes = user.tastes.length > 0;
  const name = user.nickname || user.email.split('@')[0];

  const useSaved = () => {
    dispatch({ type: 'setTastes', tastes: user.tastes });
    navigate('/time');
  };
  const edit = () => {
    dispatch({ type: 'setTastes', tastes: user.tastes });
    navigate('/taste');
  };

  return (
    <MobileShell
      screenId="U-06"
      title="저장된 취향"
      back="/entry"
      footer={
        <div className="stack gap-10">
          {hasTastes && (
            <button className="btn primary block" onClick={useSaved}>
              이 취향으로 계속
            </button>
          )}
          <button className={`btn ${hasTastes ? 'outline' : 'primary'} block`} onClick={edit}>
            {hasTastes ? '취향 수정하기' : '취향 고르러 가기'}
          </button>
        </div>
      }
    >
      <Lead
        title={`${name}님의 취향`}
        desc={hasTastes ? '지난 관람에서 저장한 취향이에요. 이번 관람에도 그대로 쓸까요?' : '아직 저장된 취향이 없어요. 간단히 골라 볼까요?'}
      />
      {hasTastes && (
        <div className="saved-taste-card">
          <span className="eyebrow">저장된 취향 키워드</span>
          <div className="chips">
            {user.tastes.map((t) => (
              <span key={t} className="chip accent">
                {TASTE_LABEL[t]}
              </span>
            ))}
          </div>
        </div>
      )}
    </MobileShell>
  );
}

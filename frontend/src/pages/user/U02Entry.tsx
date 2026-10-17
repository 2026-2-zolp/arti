/** U-02 로그인 선택 — 로그인은 필수가 아니라 선택 */
import { useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Icon } from '../../components/Icon';
import { useVisit } from '../../store/VisitContext';

export default function U02Entry() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();

  const continueAsGuest = () => {
    // 비회원으로 계속: 이번 관람만 쓰는 취향을 새로 받는다
    dispatch({ type: 'setTastes', tastes: [] });
    navigate('/taste');
  };

  return (
    <MobileShell screenId="U-02" title="시작 방법 선택" back="/">
      <Lead title="어떻게 시작할까요?" desc="로그인하지 않아도 추천·지도·작품 감상을 모두 이용할 수 있어요." />

      <ul className="benefit-list">
        <li>
          <Icon name="check" size={18} />
          로그인하면 저장된 취향을 바로 불러와요
        </li>
        <li>
          <Icon name="check" size={18} />
          관람이 끝나면 아트 영수증이 관람기록에 남아요
        </li>
      </ul>

      <div className="stack gap-12 mt-24">
        {state.user ? (
          <button className="btn primary block" onClick={() => navigate('/taste/saved')}>
            {state.user.nickname || state.user.email}님으로 계속
          </button>
        ) : (
          <button className="btn primary block" onClick={() => navigate('/login')}>
            로그인
          </button>
        )}
        <button className="btn outline block" onClick={continueAsGuest}>
          비회원으로 계속
        </button>
      </div>

      {!state.user && (
        <p className="center muted mt-24">
          아직 계정이 없나요?{' '}
          <button className="link-btn" onClick={() => navigate('/signup')}>
            회원가입
          </button>
        </p>
      )}
    </MobileShell>
  );
}

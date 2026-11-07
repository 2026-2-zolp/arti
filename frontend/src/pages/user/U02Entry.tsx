/** U-02 로그인 선택 — 로그인은 필수가 아니라 선택 */
import { useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Icon } from '../../components/Icon';
import { useLogout, useVisit } from '../../store/VisitContext';
import { useExhibitionPath, withRedirect } from '../../store/ExhibitionRoute';

export default function U02Entry() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const logout = useLogout();
  const to = useExhibitionPath();
  // 로그인·회원가입은 전시 밖 주소라, 끝나고 이 전시로 돌아올 주소를 넘긴다
  const loginPath = withRedirect('/login', to('/taste/saved'));

  const continueAsGuest = () => {
    // 비회원으로 계속: 이번 관람만 쓰는 취향을 새로 받는다
    dispatch({ type: 'setTastes', tastes: [] });
    navigate(to('/taste'));
  };

  return (
    <MobileShell screenId="U-02" title="시작 방법 선택" back={to()}>
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
        {/* 로그인한 사람은 회원 관람만 한다. 비회원으로 하려면 아래 [로그아웃] */}
        {state.user ? (
          <button className="btn primary block" onClick={() => navigate(to('/taste/saved'))}>
            {state.user.nickname || state.user.email}님으로 계속
          </button>
        ) : (
          <>
            <button className="btn primary block" onClick={() => navigate(loginPath)}>
              로그인
            </button>
            <button className="btn outline block" onClick={continueAsGuest}>
              비회원으로 계속
            </button>
          </>
        )}
      </div>

      {state.user && (
        <p className="center muted mt-24">
          <button className="link-btn" onClick={() => logout(loginPath)}>
            다른 계정으로 로그인
          </button>
          <span className="dot-sep" aria-hidden="true">·</span>
          <button className="link-btn" onClick={() => logout(to('/entry'))}>
            로그아웃
          </button>
        </p>
      )}

      {!state.user && (
        <p className="center muted mt-24">
          아직 계정이 없나요?{' '}
          <button className="link-btn" onClick={() => navigate(withRedirect('/signup', to('/taste')))}>
            회원가입
          </button>
        </p>
      )}
    </MobileShell>
  );
}

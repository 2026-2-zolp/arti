import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Lead, MobileShell } from '../../components/MobileShell';
import { withRedirect } from '../../store/ExhibitionRoute';
import { useVisit } from '../../store/VisitContext';

const MESSAGES = {
  unlinked: '연결된 ARTI 계정이 없어요. 이메일로 로그인하고 마이페이지에서 카카오 계정을 연결해 주세요.',
  conflict: '이 카카오 계정은 이미 다른 ARTI 계정에 연결되어 있어요.',
  cancelled: '카카오 인증을 취소했어요.',
  failed: '카카오 인증을 확인하지 못했어요. 처음부터 다시 시도해 주세요.',
};

export default function KakaoComplete() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [returnTo, setReturnTo] = useState('/');

  const finish = async () => {
    setPending(true);
    try {
      const result = await api.finishKakao();
      if (result.status === 'logged_in') {
        dispatch({ type: 'login', user: result.user });
        navigate(result.returnTo, { replace: true });
      } else if (result.status === 'linked') {
        navigate(result.returnTo, { replace: true });
      } else {
        setReturnTo(result.returnTo);
        setMessage(MESSAGES[result.status]);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : MESSAGES.failed);
    } finally {
      setPending(false);
    }
  };

  return (
    <MobileShell back={false}>
      <Lead title="카카오 인증 확인" />
      {message ? (
        <div className="stack gap-16">
          <p role="status">{message}</p>
          <Link className="btn outline block" to={state.user ? '/mypage' : withRedirect('/login', returnTo)} replace>
            {state.user ? '마이페이지로 돌아가기' : '로그인 화면으로 돌아가기'}
          </Link>
        </div>
      ) : (
        <button className="btn primary block" type="button" disabled={pending} onClick={finish}>
          {pending ? '확인 중…' : '계속'}
        </button>
      )}
    </MobileShell>
  );
}

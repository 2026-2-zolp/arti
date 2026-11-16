import { Link, useSearchParams } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { safeRedirect, withRedirect } from '../../store/ExhibitionRoute';

/** 로그인 지원과 재설정 메일 제공 상태를 안내합니다. */
export default function U14ForgotPassword() {
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
  const login = redirect ? withRedirect('/login', redirect) : '/login';
  return (
    <MobileShell screenId="U-14" back={login}>
      <Lead title="로그인 도움" desc="현재는 비밀번호 재설정 메일을 보낼 수 없어요." />
      <Link className="btn outline block" to={login}>로그인으로 돌아가기</Link>
    </MobileShell>
  );
}

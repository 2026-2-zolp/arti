import {Link} from 'react-router-dom';
import {MobileShell, Lead} from '../../components/MobileShell';
export default function U14ForgotPassword() {return <MobileShell title="비밀번호 찾기" screenId="U-14" back="/login"><Lead title="비밀번호 재설정을 준비 중이에요" desc="현재는 재설정 메일을 발송하지 않습니다." /><Link to="/login">로그인으로 돌아가기</Link></MobileShell>;}

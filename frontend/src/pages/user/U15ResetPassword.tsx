/** 비밀번호 재설정 미제공 안내와 로그인 복귀 화면 */
import {Link} from 'react-router-dom';
import {MobileShell, Lead} from '../../components/MobileShell';
/** 비밀번호 재설정 미제공 안내와 로그인 복귀 화면 */
export default function U15ResetPassword() {return <MobileShell title="비밀번호 재설정" screenId="U-15" back="/login"><Lead title="재설정을 아직 제공하지 않아요" desc="기존 링크로 비밀번호를 변경할 수 없습니다." /><Link to="/login">로그인으로 돌아가기</Link></MobileShell>;}

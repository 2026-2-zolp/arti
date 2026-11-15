/**
 * 끝난 관람의 영수증에서 휴대폰 뒤로가기로 이전 기록(마지막 경로·작품)에 도착했을 때 띄우는 질문.
 * 안드로이드 크롬·삼성 인터넷은 영수증 화면에서 미리 묻지만(useCloseWatcher),
 * 뒤로가기를 미리 붙잡지 못하는 브라우저(아이폰 사파리·아이폰 크롬 등)는 도착한 뒤 여기서 같은 질문을 한다.
 * 뒤 화면은 비워 두고 질문만 보인다. [머무르기]는 영수증으로, [나가기]는 [관람 완료]와 같다.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from './Confirmation';
import { load } from '../lib/storage';
import { useVisit } from '../store/VisitContext';
import { useExhibitionPath } from '../store/ExhibitionRoute';

export function FinishedVisitPrompt() {
  const confirmAction = useConfirm();
  const navigate = useNavigate();
  const to = useExhibitionPath();
  const { state, dispatch } = useVisit();

  useEffect(() => {
    // 화면이 바뀔 때 열린 질문을 닫는 처리가 끝난 뒤에 묻는다.
    const timer = window.setTimeout(() => {
      // 회원 기록이 아직 서버에 저장되지 않았으면(저장 중·실패) 영수증 화면과 같은 미저장 안내를 보여 준다.
      const unsaved = !!state.user && load(`arti.pendingReceipt.${state.user.id}.${state.visitId}`, null, 'session') !== null;
      const message = unsaved
        ? '아직 저장되지 않았어요. 현재 탭의 미저장 기록을 남기고 나갈까요? 같은 계정으로 로그인 후 마이페이지에서 재시도할 수 있어요.'
        : '관람을 종료할까요?';
      void confirmAction(message, { cancel: '머무르기', confirm: '나가기' }).then((leave) => {
        if (leave) {
          dispatch({ type: 'resetVisit' });
          navigate(to(), { replace: true });
        } else {
          navigate(to('/receipt'));
        }
      });
    }, 0);
    return () => window.clearTimeout(timer);
    // 도착했을 때 한 번만 묻는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="m-shell" aria-hidden="true" />;
}

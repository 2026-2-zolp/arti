/**
 * 전시 주소(/exhibitions/:exhibitionId/...) 공통 틀과 도우미
 *
 * - 관람 흐름의 기준은 주소의 전시 ID 하나다. Context(VisitState.exhibitionId)는 주소를 따라 복사만 한다.
 * - ExhibitionLayout: 주소의 전시 ID를 Context에 맞춘 뒤에 하위 화면을 그린다.
 *   다른 전시 주소로 들어오면 setExhibition이 진행 중이던 관람을 초기화한다.
 * - useExhibitionPath: 현재 전시 주소를 앞에 붙여 준다. to('/time') → /exhibitions/ex-mvp/time
 */
import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useVisit } from './VisitContext';

export const exhibitionPath = (exhibitionId: string, sub = '') => `/exhibitions/${encodeURIComponent(exhibitionId)}${sub}`;

export function ExhibitionLayout() {
  const { exhibitionId = '' } = useParams();
  const { state, dispatch } = useVisit();
  const synced = state.exhibitionId === exhibitionId;

  useEffect(() => {
    if (!synced) dispatch({ type: 'setExhibition', id: exhibitionId });
  }, [synced, exhibitionId, dispatch]);

  // 맞추기 전에 그리면 이전 전시의 진행 상태로 화면이 잠깐 동작할 수 있어 기다린다
  return synced ? <Outlet /> : null;
}

/** 현재 주소의 전시 ID (ExhibitionLayout 아래 화면에서만 사용) */
export function useExhibitionId(): string {
  const { exhibitionId } = useParams();
  if (!exhibitionId) throw new Error('useExhibitionId는 /exhibitions/:exhibitionId 아래 화면에서만 사용할 수 있어요.');
  return exhibitionId;
}

/** 현재 전시 주소를 붙여 주는 함수. to() → 전시 첫 화면, to('/time') → 관람 시간 */
export function useExhibitionPath() {
  const exhibitionId = useExhibitionId();
  return (sub = '') => exhibitionPath(exhibitionId, sub);
}

/** 로그인·회원가입 화면으로 갈 때 끝나고 돌아올 주소를 붙인다 */
export const withRedirect = (path: string, redirect: string) => `${path}?redirect=${encodeURIComponent(redirect)}`;

/** ?redirect= 값은 앱 안 주소(/로 시작, //는 다른 사이트라 제외)만 받는다 */
export const safeRedirect = (redirect: string | null) =>
  redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : null;

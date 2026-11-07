/**
 * 사용자 모바일 화면 공통 틀: 상단 헤더(뒤로가기·제목·우측 버튼) + 본문 + 하단 고정 버튼 영역
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

interface Props {
  title?: ReactNode;
  /** 뒤로가기 동작. 문자열이면 해당 경로로 이동, 생략하면 브라우저 이전 페이지, false면 버튼 숨김 */
  back?: string | (() => void) | false;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  screenId?: string; // 설계서 화면 ID (data 속성으로 남겨 테스트·디버깅에 활용)
}

export function MobileShell({ title, back, right, footer, children, screenId }: Props) {
  const navigate = useNavigate();

  const onBack = () => {
    if (typeof back === 'function') back();
    else if (typeof back === 'string') navigate(back);
    else navigate(-1);
  };

  return (
    <div className="m-shell" data-screen={screenId}>
      <header className="m-header">
        <div className="m-header-side">
          {back !== false && (
            <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로가기">
              <Icon name="back" size={26} />
            </button>
          )}
        </div>
        <h1 className="m-title">{title}</h1>
        <div className="m-header-side right">{right}</div>
      </header>
      <main className="m-body">{children}</main>
      {footer && <footer className="m-footer">{footer}</footer>}
    </div>
  );
}

/** 화면 상단의 큰 제목 + 보조 설명 */
export function Lead({ title, desc, center }: { title: ReactNode; desc?: ReactNode; center?: boolean }) {
  return (
    <div className={`lead ${center ? 'center' : ''}`}>
      <h2>{title}</h2>
      {desc && <p>{desc}</p>}
    </div>
  );
}

/** 로딩 표시 */
export function Spinner({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" />
      {label}
    </div>
  );
}

/**
 * 사용자 모바일 화면 공통 틀: 상단 헤더(뒤로가기·제목·우측 버튼) + 본문 + 하단 고정 버튼 영역
 */
import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { hasAppHistory } from '../lib/appHistory';

interface Props {
  title?: ReactNode;
  /**
   * 뒤로가기 동작. false면 버튼 숨김, 함수면 그 동작.
   * 문자열·생략: 앱 안에서 왔으면 이전 기록을 꺼내고(휴대폰 뒤로가기와 같음),
   * 주소로 바로 들어왔으면 문자열 경로(생략 시 전시 목록)로 덮어쓴다.
   */
  back?: string | (() => void) | false;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  screenId?: string; // 설계서 화면 ID (data 속성으로 남겨 테스트·디버깅에 활용)
  ref?: Ref<HTMLDivElement>;
}

/** 사용자 화면의 공통 틀·제목·하단 동작을 구성합니다. */
export function MobileShell({ title, back, right, footer, children, screenId, ref }: Props) {
  const navigate = useNavigate();
  const headerRef = useRef<HTMLElement>(null);

  // 실제 헤더 높이를 --m-header-h로 넘긴다(글자 크기·화면 회전으로 바뀌면 다시 잼).
  // 오류 안내를 헤더 포함 화면 가운데에 둘 때(.screen-center) 쓴다.
  useLayoutEffect(() => {
    const header = headerRef.current;
    const shell = header?.parentElement;
    if (!header || !shell) return;
    const sync = () => shell.style.setProperty('--m-header-h', `${header.offsetHeight}px`);
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const onBack = () => {
    if (typeof back === 'function') back();
    else if (hasAppHistory()) navigate(-1);
    else navigate(typeof back === 'string' ? back : '/', { replace: true });
  };

  return (
    <div ref={ref} className="m-shell" data-screen={screenId}>
      <header ref={headerRef} className="m-header">
        <div className="m-header-side">
          {back !== false && (
            <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로가기">
              <Icon name="back" size={26} />
            </button>
          )}
        </div>
        <h1 className="m-title" aria-hidden={title ? undefined : true}>{title}</h1>
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

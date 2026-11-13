import { useId, useRef } from 'react';

type Props = {
  title: string;
  sections: ReadonlyArray<{ title: string; text: string }>;
  version?: string;
};

/** 가입 입력값을 유지하면서 약관과 처리방침을 읽을 수 있게 합니다. */
export function SignupDocument({ title, sections, version }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button type="button" className="link-btn" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        {title} 보기
      </button>
      <dialog ref={dialog} className="signup-document" aria-labelledby={titleId}>
        <div className="signup-document-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="text-btn" autoFocus onClick={() => dialog.current?.close()}>닫기</button>
        </div>
        <div className="signup-document-body">
          <p className="muted small">검토용 초안 · 운영 주체, 연락처, 보유기간은 팀 확인 중입니다.</p>
          {version && <p className="muted small">버전 {version}</p>}
          {sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.text}</p>
            </section>
          ))}
        </div>
      </dialog>
    </>
  );
}

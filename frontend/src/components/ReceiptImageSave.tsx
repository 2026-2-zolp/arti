/**
 * U-12 아트 영수증 "이미지 저장·공유" 버튼
 * - 영수증 내용이 다 그려지면(ready) 화면 뒤에서 PNG를 미리 만들어 둔다.
 *   (iPhone Safari는 버튼 클릭 직후에만 공유 시트를 열어줘서, 클릭 때 만들면 거부될 수 있음)
 * - 저장 순서: ① 휴대폰 공유 시트(사진첩 저장·카톡·인스타 등) → ② 일반 다운로드 → ③ 이미지를 띄우고 "길게 눌러 저장" 안내
 * - 이미지는 브라우저 안에서만 만들고 서버로 보내지 않는다.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';

type Status = 'waiting' | 'making' | 'ready' | 'failed';

/** 그림 둘레 여백(px) */
const PAD = 20;
/** 화질 배율: 폰 화면 최대 밀도(3배) 기준. 그 이상은 눈에 보이는 차이 없이 용량만 커짐 */
const MAX_SCALE = 3;
/** iPhone Safari canvas 한 장의 픽셀 상한(약 1,670만)보다 조금 낮게 잡음. 넘으면 하얀 이미지가 나옴 */
const MAX_AREA = 16_000_000;

/** 카카오톡·인스타그램 등 앱 안의 브라우저: 다운로드가 막히는 경우가 많음 */
const isInAppBrowser = () => /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(|Line\/|DaumApps|everytimeApp/i.test(navigator.userAgent);
/** iOS: 일반 다운로드는 사진첩이 아니라 '파일' 앱으로 들어감 */
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** 터치 위주 기기(휴대폰·태블릿)에서만 공유 시트를 쓴다. PC는 바로 다운로드가 더 자연스러움 */
const isTouchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

/** PC Chrome·Edge의 "다른 이름으로 저장" 창 (TypeScript 기본 타입에 없어서 직접 선언) */
type SaveFilePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
const saveFilePicker = () => (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

/** 저장 완료 문구가 떠 있는 시간 */
const NOTE_MS = 3000;

/** 글꼴 조각 파일 → data URL (한 번 받은 건 다시 받지 않음) */
const fontDataUrls = new Map<string, Promise<string>>();
const toDataUrl = (url: string) => {
  if (!fontDataUrls.has(url)) {
    fontDataUrls.set(
      url,
      fetch(url, { cache: 'force-cache' })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then(
          (b) =>
            new Promise<string>((ok, ng) => {
              const fr = new FileReader();
              fr.onload = () => ok(String(fr.result));
              fr.onerror = () => ng(fr.error);
              fr.readAsDataURL(b);
            }),
        ),
    );
  }
  return fontDataUrls.get(url)!;
};

/** "U+AC00-D7A3, U+0041" 형태의 unicode-range 안에 text의 글자가 하나라도 있는지 */
function coversText(range: string, codes: number[]): boolean {
  if (!range) return true;
  return range.split(',').some((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-');
    const lo = parseInt(a.replace(/\?/g, '0'), 16);
    const hi = b ? parseInt(b, 16) : parseInt(a.replace(/\?/g, 'F'), 16);
    return codes.some((c) => c >= lo && c <= hi);
  });
}

/**
 * 웹폰트(Pretendard, index.html에서 CDN으로 불러옴)를 이미지 안에 넣을 CSS.
 * Pretendard는 글자 범위별로 92개 조각 파일로 나뉘어 있어서, 영수증에 실제로 쓰인 글자가 든 조각만 넣는다.
 * (라이브러리 기본 동작은 92개를 전부 받아서 휴대폰 데이터 낭비 + 느려짐)
 * 글꼴을 못 넣으면 기본 글꼴로 그려져 글자 폭이 달라지고 줄이 넘어가 깨진다.
 */
async function fontCss(node: HTMLElement): Promise<string> {
  const codes = [...new Set([...(node.textContent ?? '')].map((ch) => ch.codePointAt(0)!))];
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules; // CDN 스타일시트는 index.html의 crossorigin 속성이 있어야 읽힘
    } catch {
      continue;
    }
    for (const r of Array.from(list)) {
      if (r instanceof CSSFontFaceRule && coversText(r.style.getPropertyValue('unicode-range'), codes)) rules.push(r);
    }
  }
  const texts = await Promise.all(
    rules.map(async (r) => {
      const base = r.parentStyleSheet?.href ?? location.href;
      let css = r.cssText;
      for (const [, raw] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        if (raw.startsWith('data:')) continue;
        css = css.replace(raw, await toDataUrl(new URL(raw, base).href));
      }
      return css;
    }),
  );
  return texts.join('\n');
}

async function makePng(node: HTMLElement): Promise<Blob> {
  // 처음 저장할 때만 라이브러리를 불러온다 (다른 화면 로딩에 영향 없음)
  const { domToCanvas } = await import('modern-screenshot');
  await document.fonts?.ready;
  const width = node.offsetWidth + PAD * 2;
  const height = node.offsetHeight + PAD * 2;
  const scale = Math.min(MAX_SCALE, Math.floor(Math.sqrt(MAX_AREA / (width * height)) * 100) / 100);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fdfcf9';
  const cssText = await fontCss(node).catch(() => '');

  // 영수증 박스만 그린 뒤, 둘레 여백을 붙인 새 그림에 옮겨 담는다
  const inner = await domToCanvas(node, { scale, backgroundColor: bg, font: cssText ? { cssText } : false });
  const out = document.createElement('canvas');
  const pad = Math.round(PAD * scale);
  out.width = inner.width + pad * 2;
  out.height = inner.height + pad * 2;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(inner, pad, pad);
  return new Promise((ok, ng) => out.toBlob((b) => (b ? ok(b) : ng(new Error('toBlob'))), 'image/png'));
}

export function ReceiptImageSave({
  targetRef,
  ready,
  fileName,
}: {
  /** 이미지로 만들 영역 (영수증 박스를 감싼 요소) */
  targetRef: RefObject<HTMLElement | null>;
  /** 영수증 내용이 다 그려졌는지 (AI 해석 도착·실패 포함) */
  ready: boolean;
  /** 확장자 제외 파일명 */
  fileName: string;
}) {
  const [status, setStatus] = useState<Status>('waiting');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const generate = useCallback(async () => {
    const node = targetRef.current;
    if (!node) return;
    setStatus('making');
    setNote(null);
    try {
      const blob = await makePng(node);
      setFile(new File([blob], `${fileName}.png`, { type: 'image/png' }));
      setStatus('ready');
    } catch {
      setStatus('failed');
      setNote('이미지를 만들지 못했어요. 다시 시도해주세요.');
    }
  }, [targetRef, fileName]);

  // 영수증이 다 그려진 직후 미리 만들어 둠
  // (requestAnimationFrame은 화면이 가려지면 멈춰서 타이머를 씀)
  useEffect(() => {
    if (!ready || status !== 'waiting') return;
    const id = setTimeout(() => void generate(), 50);
    return () => clearTimeout(id);
  }, [ready, status, generate]);

  // 미리보기 주소 정리
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  // 저장 완료 문구는 3초 뒤 사라짐 (실패 문구는 남겨 둠)
  useEffect(() => {
    if (!note || status === 'failed') return;
    const id = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(id);
  }, [note, status]);

  const showPreview = (f: File) => setPreviewUrl(URL.createObjectURL(f));

  /** 일반 다운로드: 실제로 저장됐는지 알 수 없어서 문구를 띄우지 않음 */
  const download = (f: File) => {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const isAbort = (e: unknown) => (e as DOMException)?.name === 'AbortError';

  const onClick = async () => {
    if (status === 'failed') return void generate();
    if (!file) return;
    setNote(null);

    // ① 공유 시트: await 전에 바로 호출해야 iPhone Safari가 허용함
    //    사용자가 항목(사진첩 저장·카톡 등)을 고르면 완료로 끝남. 어떤 항목인지는 알 수 없음
    if (isTouchDevice() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        setNote('이미지를 저장·공유했어요.');
      } catch (e) {
        // 사용자가 메뉴를 닫은 경우는 조용히 넘어감. 그 밖의 거부는 길게 눌러 저장으로
        if (!isAbort(e)) showPreview(file);
      }
      return;
    }
    // ③ 다운로드가 막히거나 사진첩으로 안 가는 환경: 저장했는지 알 수 없어 안내 창만
    if (isInAppBrowser() || isIOS()) return showPreview(file);

    // ② PC Chrome·Edge: "다른 이름으로 저장" 창 → 파일을 다 쓴 뒤에만 완료 문구
    const picker = saveFilePicker();
    if (picker) {
      try {
        const handle = await picker({
          suggestedName: file.name,
          types: [{ description: 'PNG 이미지', accept: { 'image/png': ['.png'] } }],
        });
        const w = await handle.createWritable();
        await w.write(file);
        await w.close();
        setNote('이미지를 저장했어요.');
      } catch (e) {
        if (!isAbort(e)) download(file); // 창을 못 띄우는 환경이면 일반 다운로드로
      }
      return;
    }
    // ② PC Safari·Firefox: 일반 다운로드 (문구 없음)
    download(file);
  };

  const label = status === 'failed' ? '다시 시도' : status === 'ready' ? '이미지 저장·공유' : '이미지 준비 중…';

  return (
    <>
      <button
        type="button"
        className="btn outline block mt-12"
        onClick={onClick}
        disabled={status === 'waiting' || status === 'making'}
      >
        {label}
      </button>
      {note && (
        <p className={`center small mt-12 ${status === 'failed' ? 'error-text' : 'muted'}`} role="status">
          {note}
        </p>
      )}

      {previewUrl && (
        <div className="modal-backdrop" onClick={() => setPreviewUrl(null)}>
          <div className="modal receipt-preview" onClick={(e) => e.stopPropagation()}>
            <p className="center small">
              이미지를 <b>길게 눌러</b> 저장하세요.
            </p>
            <img src={previewUrl} alt="아트 영수증 이미지" />
            <button type="button" className="btn primary block" onClick={() => setPreviewUrl(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}

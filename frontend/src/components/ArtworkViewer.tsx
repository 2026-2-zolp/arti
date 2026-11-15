/**
 * 작품 크게 보기 화면(U-05 비교 카드·U-10 작품 감상 공통).
 * 화면 전체에 작품 전체를 보여 주고(잘리지 않게), ZoomableImage로 확대·축소·이동한다.
 * 닫기: 오른쪽 위 X 버튼 또는 PC의 Esc 키.
 */
import { useLayoutEffect, useRef } from 'react';
import { ArtImage } from './ArtImage';
import { Icon } from './Icon';
import { ZoomableImage } from './ZoomableImage';

interface Props {
  seed: string;
  palette: string[];
  imageUrl?: string | string[];
  alt: string;
  onClose: () => void;
}

export function ArtworkViewer({ seed, palette, imageUrl, alt, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    return () => dialog.close();
  }, []);

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="art-frame fullscreen"
      aria-label={`${alt} 크게 보기`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          closeRef.current?.focus();
        }
      }}
    >
      <ZoomableImage>
        <ArtImage seed={seed} palette={palette} imageUrl={imageUrl} alt={alt} fit="contain" />
      </ZoomableImage>
      <button ref={closeRef} type="button" className="frame-btn" aria-label="전체 화면 닫기" onClick={close}>
        <Icon name="close" size={18} />
      </button>
    </dialog>
  );
}

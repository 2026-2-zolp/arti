/**
 * 작품 크게 보기 화면(U-05 비교 카드·U-10 작품 감상 공통).
 * 화면 전체에 작품 전체를 보여 주고(잘리지 않게), ZoomableImage로 확대·축소·이동한다.
 * 닫기: 오른쪽 위 X 버튼 또는 PC의 Esc 키.
 */
import { useEffect } from 'react';
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="art-frame fullscreen" role="dialog" aria-modal="true" aria-label={`${alt} 크게 보기`}>
      <ZoomableImage>
        <ArtImage seed={seed} palette={palette} imageUrl={imageUrl} alt={alt} fit="contain" />
      </ZoomableImage>
      <button type="button" className="frame-btn" aria-label="전체 화면 닫기" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

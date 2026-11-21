import { Fragment, useState } from 'react';
import type { Artwork } from '../types';
import { artworkImageSrc } from './ArtImage';
import { ArtworkViewer } from './ArtworkViewer';
import { Icon } from './Icon';

type ImageAttempt = { retry: number; state: 'loading' | 'ready' | 'failed' };

interface Props {
  works: Artwork[];
  blocked: boolean;
  picked: string | null;
  onSelect: (id: string) => void;
  onReloadPool: () => void;
}

// Uploaded images use an unchanged file path. Refresh a failed cached response
// without modifying the URL of an external image.
function imageSource(work: Artwork, retry: number) {
  const original = artworkImageSrc(work);
  if (!original || !retry || !work.imageFile) return original;
  const url = new URL(original, document.baseURI);
  url.searchParams.set('retry', String(retry));
  return url.href;
}

export default function TastePair({ works, blocked, picked, onSelect, onReloadPool }: Props) {
  const [attempts, setAttempts] = useState<Partial<Record<string, ImageAttempt>>>({});
  const [viewing, setViewing] = useState<{ work: Artwork; src: string } | null>(null);
  const selectable = !blocked && !picked && works.every(work => attempts[work.id]?.state === 'ready');

  function settle(id: string, retry: number, state: 'ready' | 'failed') {
    setAttempts(current => (current[id]?.retry ?? 0) === retry
      ? { ...current, [id]: { retry, state } }
      : current);
  }

  return (
    <div className="duel duel-compact">
      {works.map((work, index) => {
        const retry = attempts[work.id]?.retry ?? 0;
        const src = imageSource(work, retry);
        const imageState = src ? attempts[work.id]?.state ?? 'loading' : 'failed';
        const isPicked = picked === work.id;
        return (
          <Fragment key={work.id}>
            {index > 0 && <p className="duel-separator" aria-hidden="true">또는</p>}
            <div className={`duel-card${isPicked ? ' picked' : ''}`}>
              <button type="button" className="duel-card-hit" aria-label={`${work.title} 선택`}
                aria-pressed={isPicked} disabled={!selectable} onClick={() => { if (selectable) onSelect(work.id); }} />
              <div className="duel-visual" data-state={imageState}>
                {src && imageState !== 'failed' && (
                  <img key={retry} src={src} alt="" onLoad={event => {
                    settle(work.id, retry, event.currentTarget.naturalWidth > 0 ? 'ready' : 'failed');
                  }} onError={() => settle(work.id, retry, 'failed')} />
                )}
                {imageState !== 'ready' && (
                  <div className="duel-image-status">
                    <p role={imageState === 'failed' ? 'alert' : 'status'}>
                      {imageState === 'failed' ? '도판을 불러오지 못했어요.' : '도판을 불러오는 중…'}
                    </p>
                    {imageState === 'failed' && (
                      <button type="button" className="duel-retry" aria-label={`${work.title} 도판 다시 시도`}
                        onClick={() => {
                          if (!src) {
                            onReloadPool();
                            return;
                          }
                          setAttempts(current => ({ ...current, [work.id]: { retry: Date.now(), state: 'loading' } }));
                        }}>다시 시도</button>
                    )}
                  </div>
                )}
                <button type="button" className="duel-zoom" aria-label={`${work.title} 크게 보기`}
                  disabled={blocked || !!picked || imageState !== 'ready'}
                  onClick={() => { if (src) setViewing({ work, src }); }}>
                  <Icon name="expand" size={16} />확대
                </button>
              </div>
              <div className="duel-caption">
                <span className="duel-title">{work.title}</span>
                <span className="duel-select-label" aria-hidden="true">{isPicked ? '선택함' : '선택'}</span>
              </div>
            </div>
          </Fragment>
        );
      })}
      {viewing && <ArtworkViewer seed={viewing.work.id} palette={viewing.work.palette}
        imageUrl={viewing.src} alt={viewing.work.title} onClose={() => setViewing(null)} />}
    </div>
  );
}

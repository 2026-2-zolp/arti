/**
 * U-05 취향 파악 — 작품 약 10점을 두 점씩 보여 주고 하나만 고르게 한다.
 * 다 고르면 고른 작품에 붙은 태그로 취향 태그를 만들어 보여 주고(lib/tasteFromPicks.ts), 확인하면 관람 시간으로 간다.
 * 로그인 사용자는 확인할 때 이 태그가 계정의 저장 취향이 된다(덮어쓰기).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { tastesFromPicks } from '../../lib/tasteFromPicks';
import { TASTE_LABEL } from '../../data/mock';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionId, useExhibitionPath } from '../../store/ExhibitionRoute';
import type { Artwork, TasteTag } from '../../types';

const POOL = 10;

function pairsOf(works: Artwork[]): [Artwork, Artwork][] {
  const even = works.slice(0, works.length - (works.length % 2));
  const pairs: [Artwork, Artwork][] = [];
  for (let i = 0; i < even.length; i += 2) pairs.push([even[i], even[i + 1]]);
  return pairs;
}

export default function U05Taste() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const exhibitionId = useExhibitionId();
  const to = useExhibitionPath();
  const { data, loading, error } = useAsync(() => api.listArtworks(exhibitionId), [exhibitionId]);
  const pairs = useMemo(() => pairsOf((data ?? []).slice(0, POOL)), [data]);
  const [step, setStep] = useState(0);
  /** 지금까지 고른 작품 id (한 단계에 하나씩) */
  const [picks, setPicks] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  /** 다 고른 뒤 만든 취향 태그. null이면 아직 고르는 중 */
  const [result, setResult] = useState<TasteTag[] | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const choose = (id: string) => {
    if (timer.current) return;
    const nextPicks = [...picks, id];
    setPicked(id);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPicked(null);
      setPicks(nextPicks);
      if (step + 1 < pairs.length) {
        setStep((n) => n + 1);
        return;
      }
      setResult(tastesFromPicks(data ?? [], nextPicks));
    }, 420);
  };

  const undo = () => {
    if (timer.current) return;
    if (result) {
      // 결과 화면에서 [이전]: 마지막 선택으로 돌아간다
      setResult(null);
      setPicks((cur) => cur.slice(0, -1));
      setStep(Math.max(pairs.length - 1, 0));
      return;
    }
    if (step === 0) return;
    setPicks((cur) => cur.slice(0, -1));
    setStep((n) => n - 1);
  };

  const confirm = () => {
    if (!result || result.length === 0) return;
    dispatch({ type: 'finishTaste', tastes: result });
    // 회원이면 계정의 저장 취향을 이번 결과로 바꾼다 (U-06에 다음부터 보임).
    // 저장에 실패해도 이번 관람은 그대로 진행한다.
    const user = state.user;
    if (user) {
      const tastes = result;
      api
        .updateTastes(user.id, tastes)
        .then(() => dispatch({ type: 'setUserTastes', tastes }))
        .catch(() => undefined);
    }
    navigate(to('/time'));
  };

  const pair = pairs[step];

  return (
    <MobileShell
      screenId="U-05"
      title="취향 파악"
      right={
        step > 0 || result ? (
          <button type="button" className="text-btn" onClick={undo}>
            이전
          </button>
        ) : undefined
      }
      footer={
        result ? (
          <button className="btn primary block" onClick={confirm} disabled={result.length === 0}>
            이 취향으로 계속
          </button>
        ) : undefined
      }
    >
      {result ? (
        <Lead title="이런 태그가 나왔어요" desc="고른 작품에서 많이 겹친 특성이에요. 이 태그로 작품을 추천합니다." />
      ) : (
        <Lead title="둘 중 더 끌리는 작품을 골라주세요" desc="한 번에 두 점만 보여 드려요. 더 끌리는 쪽을 눌러 주세요." />
      )}

      {loading && <Spinner label="작품을 불러오는 중…" />}
      {error && <p className="muted">{error}</p>}
      {!loading && !error && pairs.length === 0 && (
        <p className="muted">비교할 작품이 아직 부족해요. 작품이 두 점 이상 등록되면 고를 수 있어요.</p>
      )}

      {result && (
        <div className="saved-taste-card">
          <span className="eyebrow">취향 태그</span>
          {result.length > 0 ? (
            <div className="chips">
              {result.map((tag) => (
                <span key={tag} className="chip accent">
                  {TASTE_LABEL[tag]}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">고른 작품에서 취향 태그를 찾지 못했어요. [이전]을 눌러 다시 골라 주세요.</p>
          )}
          <ul className="tag-count-list">
            {picks.map((id) => {
              const work = data?.find((w) => w.id === id);
              const count = work?.tags.filter((t) => t in TASTE_LABEL).length ?? 0;
              return (
                <li key={id}>
                  <span>{work?.title ?? id}</span>
                  <span className="muted small">태그 {count}개</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {pair && !result && (
        <>
          <div className="duel-dots" aria-label={`${step + 1}번째, 모두 ${pairs.length}번`}>
            {pairs.map((_, i) => (
              <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />
            ))}
          </div>
          <div className="duel">
            {pair.map((w, index) => (
              <div key={w.id} className="duel-slot">
                {index === 1 && <p className="duel-or">또는</p>}
                <button
                  type="button"
                  className={`duel-card ${picked === w.id ? 'picked' : ''}`}
                  disabled={picked !== null}
                  onClick={() => choose(w.id)}
                >
                  <ArtImage seed={w.id} palette={w.palette} imageUrl={artworkImageSrc(w)} alt={w.title} ratio={16 / 9} />
                  <span className="duel-title">{w.title}</span>
                  <span className="muted small">
                    {w.artist}
                    {w.year ? ` · ${w.year}` : ''}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </MobileShell>
  );
}

/** 다섯 작품 쌍의 선택 초안에서 취향 확인 화면으로 이어집니다. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import TasteReview from '../../components/TasteReview';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { load, save } from '../../lib/storage';
import { tasteScope } from '../../lib/tasteFlow';
import { tastesFromPicks } from '../../lib/tasteFromPicks';
import { TASTE_LABEL } from '../../data/mock';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionPath } from '../../store/ExhibitionRoute';
import type { TasteProfile, TasteTag } from '../../types';

interface Draft {
  picks: string[];
  version?: 1 | 2;
  poolVersion?: string;
  tieContextVersion?: string;
  options?: TasteTag[];
  tags?: TasteTag[];
}

export default function U05Taste() {
  const { state } = useVisit();
  const scope = tasteScope(state);
  return <TasteDraft key={scope} draftKey={`arti.tasteDraft.${scope}`} />;
}

function TasteDraft({ draftKey }: { draftKey: string }) {
  const { state } = useVisit();
  const to = useExhibitionPath();
  const [draft, setDraft] = useState(() => load<Draft>(draftKey, { picks: [] }, 'session'));
  const [picked, setPicked] = useState<string | null>(null);
  const pickTimer = useRef<number | null>(null);
  const { data: pool, loading, error, reload } = useAsync(() => api.tastePool(), [], true);
  const v2 = pool?.tasteTieV2Enabled === true && pool.supportedTasteProfileVersions?.includes(2) === true;
  const version = draft.version ?? (v2 ? 2 : 1);
  const contextVersion = pool?.tieContext?.tieContextVersion ?? undefined;
  const missingContext = v2 && !contextVersion;
  const pairs = pool?.pairs ?? [];
  const selected = draft.tags ?? [];
  const complete = draft.options !== undefined;
  const samePairs = draft.picks.every((id, index) => {
    const pair = pairs[index];
    return pair?.leftId === id || pair?.rightId === id;
  });
  const changed = !!pool && !!draft.picks.length && (draft.poolVersion !== pool.poolVersion ||
    (version === 2) !== v2 || draft.tieContextVersion !== (v2 ? contextVersion : undefined) || !samePairs);
  const blocked = loading || !!error || !pool?.ready || changed || missingContext;
  const poolVersion = pool?.poolVersion;
  useEffect(() => {
    setPicked(null);
    return () => {
      if (pickTimer.current !== null) window.clearTimeout(pickTimer.current);
      pickTimer.current = null;
    };
  }, [blocked, poolVersion, contextVersion]);
  const needsReload = !!error || missingContext || changed || !pool?.ready;
  const currentPair = pairs[draft.picks.length];
  const works = currentPair ? [currentPair.leftId, currentPair.rightId].flatMap(id => pool?.artworks.find(w => w.id === id) ?? []) : [];
  const manual = selected.some(tag => !draft.options?.includes(tag));
  const counts: TasteProfile['counts'] = {};
  if (!manual && version === 1) {
    for (const id of draft.picks) {
      for (const tag of pool?.artworks.find(w => w.id === id)?.tags ?? []) counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  const profile: TasteProfile = {
    version, source: manual ? 'manual' : 'picks', selectedTags: selected,
    counts, poolVersion: manual ? null : draft.poolVersion ?? null,
    tieContextVersion: !manual && version === 2 ? draft.tieContextVersion : undefined,
    picks: manual ? [] : draft.picks.map((artworkId, pairIndex) => ({ pairIndex, artworkId })),
  };

  function update(next: Draft) {
    save(draftKey, next, 'session');
    setDraft(next);
  }

  function choose(id: string) {
    if (!pool?.ready || blocked || complete || pickTimer.current !== null) return;
    const picks = [...draft.picks, id];
    const options = picks.length === pairs.length ? tastesFromPicks(pool.artworks, picks) : undefined;
    setPicked(id);
    pickTimer.current = window.setTimeout(() => {
      pickTimer.current = null;
      setPicked(null);
      update({ picks, version, poolVersion: pool.poolVersion, tieContextVersion: v2 ? contextVersion : undefined, options, tags: options });
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
  }

  const reviewKey = `${draftKey}.review.${JSON.stringify(profile)}`;
  return (
    <MobileShell screenId="U-05" back={to(state.user?.tastes.length ? '/taste/saved' : '/entry')}
      right={draft.picks.length > 0 && <button type="button" className="text-btn" disabled={picked !== null} onClick={() =>
        update({ ...draft, picks: draft.picks.slice(0, -1), options: undefined, tags: undefined })}>이전 선택</button>}>
      <Lead title={complete ? '추천에 쓸 취향을 골라 주세요' : '둘 중 더 끌리는 작품을 골라주세요'}
        desc={complete ? undefined : '전시와 관계없이 취향을 알아보는 작품이에요. 더 끌리는 쪽을 다섯 번 골라 주세요.'} />
      {!complete && loading && !pool && <Spinner label="작품을 불러오는 중…" />}
      {!complete && error && <p role="alert">{error}</p>}
      {!complete && !loading && !error && !pool?.ready && <p>취향 조사 작품을 불러올 수 없어요.</p>}
      {!complete && !loading && missingContext && <p role="alert">취향 조사 근거를 다시 불러와 주세요.</p>}
      {!complete && (loading ? !!pool : needsReload) && (
        <button type="button" className="btn outline" disabled={loading} aria-busy={loading} onClick={reload}>
          {loading ? '조사 근거 확인 중…' : '조사 근거 다시 불러오기'}
        </button>
      )}
      {pool?.ready && changed && !loading && !error && !missingContext && (
        <div className="stack gap-12">
          <p role="status">조사 근거가 바뀌었어요. 고른 작품은 초안에 남아 있어요.</p>
          {samePairs && (version === 1 || v2)
            ? <button type="button" className="btn outline" onClick={() => update({ ...draft, version: v2 ? 2 : 1, poolVersion: pool.poolVersion,
                tieContextVersion: v2 ? contextVersion : undefined,
                options: complete ? tastesFromPicks(pool.artworks, draft.picks) : undefined })}>고른 작품을 최신 근거로 확인</button>
            : <button type="button" className="btn outline" onClick={() => update({ picks: [] })}>작품을 처음부터 다시 고르기</button>}
        </div>
      )}
      {complete && (
        <div className="saved-taste-card stack gap-12">
          <div className="chips" aria-label="취향 태그">
            {(Object.keys(TASTE_LABEL) as TasteTag[]).map(tag => (
              <button type="button" key={tag} aria-pressed={selected.includes(tag)}
                className={`chip ${selected.includes(tag) ? 'accent' : ''}`}
                onClick={() => update({ ...draft, tags: selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag] })}>
                {TASTE_LABEL[tag]}
              </button>
            ))}
          </div>
          {manual && <p>고른 작품에 없는 태그를 포함했어요. 선택한 태그를 같은 비중으로 추천에 사용합니다.</p>}
          {!selected.length && <p>취향 태그를 하나 이상 골라 주세요.</p>}
          {selected.length > 0 && (version === 2 || pool?.ready) && (
            <TasteReview key={reviewKey} storageKey={reviewKey} profile={profile} blocked={blocked} />
          )}
          {error && <p role="alert">{error} 고른 작품과 태그는 남아 있어요.</p>}
          {!loading && !error && (!pool?.ready || missingContext) && <p role="status">취향 조사 근거를 다시 확인해 주세요.</p>}
          <button type="button" className="text-btn" disabled={loading} aria-busy={loading} onClick={reload}>
            {loading ? '조사 근거 확인 중…' : '조사 근거 다시 불러오기'}
          </button>
        </div>
      )}
      {pool?.ready && !complete && !changed && !missingContext && works.length === 2 && (
        <>
          <div className="duel-dots" aria-label={`${draft.picks.length + 1}번째, 모두 ${pairs.length}번`}>
            {pairs.map((_, index) => <span key={index} className={index === draft.picks.length ? 'on' : index < draft.picks.length ? 'done' : ''} />)}
          </div>
          <div className="duel duel-compact">
            {works.map((work) => (
              <div key={work.id} className="duel-slot">
                <button type="button" className={`duel-card${picked === work.id ? ' picked' : ''}`}
                  aria-pressed={picked === work.id} disabled={blocked || picked !== null} onClick={() => choose(work.id)}>
                  <ArtImage seed={work.id} palette={work.palette} imageUrl={artworkImageSrc(work)} alt="" ratio={5 / 2} fit="contain" />
                  <span className="duel-title">{work.title}</span>
                  <span className="muted small">{work.artist}{work.year ? ` · ${work.year}` : ''}</span>
                  {picked === work.id && <span className="duel-picked" aria-hidden="true">선택함</span>}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {state.duration && <Link to={to('/recommend')}>현재 관람으로 돌아가기</Link>}
    </MobileShell>
  );
}

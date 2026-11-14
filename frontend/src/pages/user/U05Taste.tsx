/** 다섯 작품 쌍의 선택 초안에서 취향 확인 화면으로 이어집니다. */
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import TasteReview from '../../components/TasteReview';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { errorDetail } from '../../lib/errorText';
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

type LoadIssue = 'error' | 'notReady' | 'noContext' | null;

function TasteDraft({ draftKey }: { draftKey: string }) {
  const { state } = useVisit();
  const to = useExhibitionPath();
  const [draft, setDraft] = useState(() => load<Draft>(draftKey, { picks: [] }, 'session'));
  const [picked, setPicked] = useState<string | null>(null);
  const pickTimer = useRef<number | null>(null);
  // 다시 불러오는 동안에도 직전 오류 카드를 그대로 보여 주기 위해 마지막 상태를 기억한다.
  const lastLoadIssue = useRef<LoadIssue>(null);
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
  const nextPair = pairs[draft.picks.length + 1];
  const nextLeft = pool?.artworks.find((work) => work.id === nextPair?.leftId);
  const nextRight = pool?.artworks.find((work) => work.id === nextPair?.rightId);
  const nextLeftImage = nextLeft && artworkImageSrc(nextLeft);
  const nextRightImage = nextRight && artworkImageSrc(nextRight);
  useEffect(() => {
    if (blocked || complete) return;
    for (const url of new Set([nextLeftImage, nextRightImage])) {
      if (!url) continue;
      const image = new Image();
      image.fetchPriority = 'low';
      image.src = url;
    }
  }, [blocked, complete, nextLeftImage, nextRightImage]);
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
  // 관람 도중 취향을 다시 고르러 왔을 때만 보이는 [현재 관람으로 돌아가기]. 다른 화면의 보조 버튼(회색 글자)과 같은 모양으로 둔다.
  const backToVisit = state.duration && (
    <Link className="btn ghost block" to={to('/recommend')}>현재 관람으로 돌아가기</Link>
  );
  const retryButton = (
    <button type="button" className="btn primary block" disabled={loading} aria-busy={loading} onClick={reload}>
      {loading ? '확인 중…' : '다시 시도하기'}
    </button>
  );
  // 작품을 고르기 전 불러오기 문제(실패·준비 안 됨·근거 다시 필요)일 때는 제목 없이 안내 카드만 화면 가운데에 둔다.
  // 다시 불러오는 동안에는 직전 카드를 유지하고, 카드 안 버튼만 "확인 중…"으로 바뀐다.
  const issueNow: LoadIssue = complete ? null : error ? 'error' : loading ? null
    : !pool?.ready ? 'notReady' : missingContext ? 'noContext' : null;
  if (!loading) lastLoadIssue.current = issueNow;
  const loadIssue: LoadIssue = loading && !complete ? lastLoadIssue.current : issueNow;
  return (
    <MobileShell screenId="U-05" back={to(state.user?.tastes.length ? '/taste/saved' : '/entry')}
      right={draft.picks.length > 0 && <button type="button" className="text-btn" disabled={picked !== null} onClick={() =>
        update({ ...draft, picks: draft.picks.slice(0, -1), options: undefined, tags: undefined })}>이전 선택</button>}>
      {!loadIssue && <Lead title={complete ? '추천에 쓸 취향을 골라 주세요' : '둘 중 더 끌리는 작품을 골라주세요'} />}
      {!complete && loading && !pool && !loadIssue && <Spinner label="작품을 불러오는 중…" />}
      {/* 불러오기 실패·준비 안 됨·근거 다시 필요: 카드 안의 [다시 시도하기]가 조사 근거를 다시 불러온다(reload, 기존 버튼과 같은 동작). */}
      {loadIssue === 'error' && (
        <div className="notice-card is-err notice-center screen-center" role="alert">
          <p className="notice-body">취향 조사 작품을 불러오지 못했어요.{errorDetail(error)}</p>
          {retryButton}
          {backToVisit}
        </div>
      )}
      {loadIssue === 'notReady' && (
        <div className="notice-card notice-center screen-center">
          <p className="notice-body">취향 조사 작품을 불러올 수 없어요.</p>
          {retryButton}
          {backToVisit}
        </div>
      )}
      {loadIssue === 'noContext' && (
        <div className="notice-card is-err notice-center screen-center" role="alert">
          <p className="notice-body">취향 조사 근거를 다시 불러와 주세요.</p>
          {retryButton}
          {backToVisit}
        </div>
      )}
      {/* 조사 근거가 바뀐 안내와 다시 불러오는 중에는 기존 버튼을 그대로 둔다. */}
      {!complete && !loadIssue && (loading ? !!pool : needsReload && !error && !!pool?.ready && !missingContext) && (
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
          {error && <div className="notice-card is-err" role="alert"><p className="notice-body">취향 조사 근거를 불러오지 못했어요.{errorDetail(error)} 고른 작품과 태그는 남아 있어요.</p></div>}
          {!loading && !error && (!pool?.ready || missingContext) && <p role="status">취향 조사 근거를 다시 확인해 주세요.</p>}
          <button type="button" className="text-btn" disabled={loading} aria-busy={loading} onClick={reload}>
            {loading ? '조사 근거 확인 중…' : '조사 근거 다시 불러오기'}
          </button>
        </div>
      )}
      {pool?.ready && !complete && !changed && !missingContext && works.length === 2 && (
        <>
          <div className="duel-progress" role="status">
            <div className="duel-dots" aria-hidden="true">
              {pairs.map((_, index) => <span key={index} className={index === draft.picks.length ? 'on' : index < draft.picks.length ? 'done' : ''} />)}
            </div>
            <span aria-hidden="true">{draft.picks.length + 1}/{pairs.length}</span>
            <span className="sr-only">{draft.picks.length + 1}번째, 모두 {pairs.length}번</span>
          </div>
          <div className="duel duel-compact">
            {works.map((work, index) => (
              <Fragment key={work.id}>
                {index > 0 && <p className="duel-separator" aria-hidden="true">또는</p>}
                <button type="button" className={`duel-card${picked === work.id ? ' picked' : ''}`}
                  aria-pressed={picked === work.id} disabled={blocked || picked !== null} onClick={() => choose(work.id)}>
                  <ArtImage seed={work.id} palette={work.palette} imageUrl={artworkImageSrc(work)} alt="" ratio={5 / 2} fit="contain" />
                  <span className="duel-title">{work.title}</span>
                  {picked === work.id && <span className="duel-picked" aria-hidden="true">선택함</span>}
                </button>
              </Fragment>
            ))}
          </div>
          <details key={draft.picks.length} className="duel-metadata">
            <summary>작가·연도</summary>
            <dl>
              {works.map((work) => (
                <div key={work.id}>
                  <dt>{work.title}</dt>
                  <dd>{[work.artist, work.year].filter(Boolean).join(' · ') || '정보 없음'}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
      {/* 오류 카드가 있을 때는 카드 안에, 그 밖에는 화면 아래쪽에 둔다. */}
      {!loadIssue && backToVisit && <div className="mt-12">{backToVisit}</div>}
    </MobileShell>
  );
}

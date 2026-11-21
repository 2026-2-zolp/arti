/** 다섯 작품 쌍의 선택 초안에서 취향 확인 화면으로 이어집니다. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lead, MobileShell, Spinner } from '../../components/MobileShell';
import { ArtImage, artworkImageSrc } from '../../components/ArtImage';
import { ArtworkViewer } from '../../components/ArtworkViewer';
import { Icon } from '../../components/Icon';
import TasteReview from '../../components/TasteReview';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { errorDetail } from '../../lib/errorText';
import { load, save } from '../../lib/storage';
import { tasteScope } from '../../lib/tasteFlow';
import { newVisitId } from '../../lib/visitScope';
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
  pickEvidence?: TasteProfile['pickEvidence'];
  options?: TasteTag[];
  tags?: TasteTag[];
  tagsEdited?: boolean;
}

export default function U05Taste() {
  const { state } = useVisit();
  const scope = tasteScope(state);
  return <TasteDraft key={scope} draftKey={`arti.tasteDraft.${scope}`} />;
}

type LoadIssue = 'error' | 'notReady' | 'noContext' | null;

type TasteEntry = { key: string; depth: number };

function TasteDraft({ draftKey }: { draftKey: string }) {
  const { state } = useVisit();
  const navigate = useNavigate();
  const location = useLocation();
  const to = useExhibitionPath();
  const historyPrefix = `arti.tasteDraft.history.${JSON.stringify([state.user?.id ?? null, state.exhibitionId])}.`;
  const storedEntry: TasteEntry | undefined = location.state?.tasteEntry;
  const entryStorageKey = storedEntry ? historyPrefix + storedEntry.key : null;
  const entryDraft = useMemo(() => entryStorageKey ? load<Draft | null>(entryStorageKey, null, 'session') : null,
    [entryStorageKey, location.key]);
  const entry = entryDraft ? storedEntry : undefined;
  const [storedDraft, setStoredDraft] = useState(() => load<Draft>(draftKey, { picks: [] }, 'session'));
  const [entryEdit, setEntryEdit] = useState<{ locationKey: string; draft: Draft }>();
  const draft = entryEdit?.locationKey === location.key ? entryEdit.draft : entryDraft ?? storedDraft;
  const [picked, setPicked] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null); // 크게 보기로 연 작품 ID
  const pickTimer = useRef<number | null>(null);
  // 다시 불러오는 동안에도 직전 오류 카드를 그대로 보여 주기 위해 마지막 상태를 기억한다.
  const lastLoadIssue = useRef<LoadIssue>(null);
  const { data: pool, loading, error, reload } = useAsync(() => api.tastePool(), [], true);
  const v2 = pool?.tasteTieV2Enabled === true && pool.supportedTasteProfileVersions?.includes(2) === true;
  const version = draft.version ?? (v2 ? 2 : 1);
  const contextVersion = pool?.tieContext?.tieContextVersion ?? undefined;
  const pairEvidence = v2 ? pool?.tieContext?.pickEvidence : undefined;
  const missingContext = v2 && !contextVersion;
  const pairs = pool?.pairs ?? [];
  const selected = draft.tags ?? [];
  const complete = draft.options !== undefined;
  const samePairs = draft.picks.every((id, index) => {
    const pair = pairs[index];
    return pair?.leftId === id || pair?.rightId === id;
  });
  const changed = !!pool && !!draft.picks.length && (draft.poolVersion !== pool.poolVersion ||
    (version === 2) !== v2 || draft.tieContextVersion !== (v2 ? contextVersion : undefined) || !samePairs ||
    (draft.pickEvidence !== undefined && draft.pickEvidence !== pairEvidence));
  const blocked = loading || !!error || !pool?.ready || changed || missingContext;
  const poolVersion = pool?.poolVersion;
  useEffect(() => {
    setPicked(null);
    return () => {
      if (pickTimer.current !== null) window.clearTimeout(pickTimer.current);
      pickTimer.current = null;
    };
  }, [blocked, poolVersion, contextVersion, location.key]);
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
    pickEvidence: !manual && version === 2 ? draft.pickEvidence : undefined,
    picks: manual ? [] : draft.picks.map((artworkId, pairIndex) => ({ pairIndex, artworkId })),
  };

  const persist = useCallback((next: Draft) => {
    save(draftKey, next, 'session');
    setStoredDraft(next);
  }, [draftKey]);

  // 라우터 이력에는 복원 키만 담는다. 선택 내용은 로그아웃 시 정리되는 세션 저장소에 둔다.
  const writeEntry = useCallback((next: Draft, depth: number, replace: boolean) => {
    const key = (replace && entry?.key) || newVisitId();
    save(historyPrefix + key, next, 'session');
    navigate(location.pathname, { replace, state: { tasteEntry: { key, depth } } });
  }, [entry?.key, historyPrefix, location.pathname, navigate]);
  const restartPending = useRef(false);
  useEffect(() => {
    if (restartPending.current) {
      restartPending.current = false;
      const empty = { picks: [] };
      persist(empty);
      writeEntry(empty, 0, true);
    } else if (entryDraft) {
      persist(entryDraft);
    }
  }, [entryDraft, persist, writeEntry]);

  function update(next: Draft) {
    // Editing the current step must be visible before another tag is tapped.
    // Keep its history key so back, forward and reload can still restore it.
    if (entry && entryStorageKey) {
      save(entryStorageKey, next, 'session');
      setEntryEdit({ locationKey: location.key, draft: next });
    }
    persist(next);
  }
  const stepBack = () => {
    if (picked !== null || !draft.picks.length) return;
    if (entry && entry.depth > 0) navigate(-1);
    else update({ ...draft, picks: draft.picks.slice(0, -1), options: undefined, tags: undefined, tagsEdited: undefined });
  };
  const restart = () => {
    if (entry && entry.depth > 0) {
      restartPending.current = true;
      navigate(-entry.depth);
    } else update({ picks: [] });
  };

  function choose(id: string) {
    if (!pool?.ready || blocked || complete || pickTimer.current !== null) return;
    const picks = [...draft.picks, id];
    const suggested = picks.length === pairs.length
      ? tastesFromPicks(pool.artworks, picks, pairEvidence ? pairs : undefined) : undefined;
    setPicked(id);
    pickTimer.current = window.setTimeout(() => {
      pickTimer.current = null;
      setPicked(null);
      const next = { picks, version, poolVersion: pool.poolVersion, tieContextVersion: v2 ? contextVersion : undefined,
        pickEvidence: pairEvidence, options: suggested?.options, tags: suggested?.defaultTags,
        tagsEdited: suggested ? false : undefined };
      if (!entry) writeEntry(draft, 0, true);
      persist(next);
      writeEntry(next, (entry?.depth ?? 0) + 1, false);
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
  }

  function acceptUpdatedEvidence() {
    if (!pool?.ready) return;
    const suggested = complete
      ? tastesFromPicks(pool.artworks, draft.picks, pairEvidence ? pairs : undefined) : undefined;
    update({ ...draft, version: v2 ? 2 : 1, poolVersion: pool.poolVersion,
      tieContextVersion: v2 ? contextVersion : undefined, pickEvidence: pairEvidence,
      options: suggested?.options, tags: draft.tagsEdited === false ? suggested?.defaultTags : draft.tags });
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
    // 고른 쌍이 있으면 ←는 마지막 선택 취소(이전 쌍), 없으면 들어오기 전 화면. [이전 선택] 버튼은 ←와 같아 뺐다.
    <MobileShell screenId="U-05" back={draft.picks.length > 0 ? stepBack : to(state.user?.tastes.length ? '/taste/saved' : '/entry')}>
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
            ? <button type="button" className="btn outline" onClick={acceptUpdatedEvidence}>고른 작품을 최신 근거로 확인</button>
            : <button type="button" className="btn outline" onClick={restart}>작품을 처음부터 다시 고르기</button>}
        </div>
      )}
      {complete && (
        <div className="saved-taste-card stack gap-12">
          {draft.pickEvidence && !draft.tagsEdited && selected.length > 0 &&
            <p className="muted small">고른 작품의 차이를 반영했어요. 원하는 태그만 조정할 수 있어요.</p>}
          <div className="chips" aria-label="취향 태그">
            {(Object.keys(TASTE_LABEL) as TasteTag[]).map(tag => (
              <button type="button" key={tag} aria-pressed={selected.includes(tag)}
                className={`chip ${selected.includes(tag) ? 'accent' : ''}`}
                onClick={() => update({ ...draft, tagsEdited: true,
                  tags: selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag] })}>
                {TASTE_LABEL[tag]}
              </button>
            ))}
          </div>
          {manual && <p>비교에서 나온 태그 외에 직접 더한 태그가 있어요. 선택한 태그는 같은 비중으로 반영해요.</p>}
          {!selected.length && <p>이번 관람에 쓰고 싶은 태그를 하나 이상 골라 주세요.</p>}
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
                {/* 확대 아이콘만 크게 보기. 그림과 제목은 이 작품을 고르고 다음 쌍으로 넘긴다. */}
                <div className={`duel-card${picked === work.id ? ' picked' : ''}`}>
                  <div className="duel-visual">
                    <ArtImage seed={work.id} palette={work.palette} imageUrl={artworkImageSrc(work)} alt="" ratio={5 / 2} fit="contain" />
                    <button type="button" className="duel-zoom" aria-label={`${work.title} 크게 보기`} onClick={() => setViewing(work.id)}>
                      <Icon name="expand" size={16} />
                    </button>
                  </div>
                  <button type="button" className="duel-card-hit" aria-label={`${work.title} 선택`} aria-pressed={picked === work.id}
                    disabled={blocked || picked !== null} onClick={() => choose(work.id)} />
                  <button type="button" className="duel-title" aria-pressed={picked === work.id}
                    disabled={blocked || picked !== null} onClick={() => choose(work.id)}>
                    {work.title}
                  </button>
                  {picked === work.id && <span className="duel-picked" aria-hidden="true">선택함</span>}
                </div>
              </Fragment>
            ))}
          </div>
          {(() => {
            const work = works.find((w) => w.id === viewing);
            return work && (
              <ArtworkViewer seed={work.id} palette={work.palette} imageUrl={artworkImageSrc(work)} alt={work.title} onClose={() => setViewing(null)} />
            );
          })()}
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

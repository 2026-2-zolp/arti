/** 미리 확인한 취향을 계정 또는 이번 관람에 적용합니다. */
import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { TASTE_LABEL } from '../data/mock';
import { load, remove, save } from '../lib/storage';
import { authSession, sameTaste, saveConfirmedTaste, tasteScope, type TasteMutation, type TastePreview } from '../lib/tasteFlow';
import { newVisitId } from '../lib/visitScope';
import { useExhibitionPath } from '../store/ExhibitionRoute';
import { useVisit } from '../store/VisitContext';
import type { TasteProfile, User } from '../types';
import { useConfirm } from './Confirmation';

interface ReviewState {
  visitId: string;
  preview?: TastePreview;
  expectedVersion?: number;
  mutation?: TasteMutation;
  acknowledged?: boolean;
}

export default function TasteReview({ profile, storageKey, saveAccount = true, blocked = false }: {
  profile: TasteProfile; storageKey: string; saveAccount?: boolean; blocked?: boolean;
}) {
  const { state, dispatch } = useVisit();
  const scope = tasteScope(state);
  const navigate = useNavigate();
  const to = useExhibitionPath();
  const confirm = useConfirm();
  const [review, setReview] = useState(() => load<ReviewState | null>(storageKey, null, 'session') ?? { visitId: newVisitId() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const blockedNow = useRef(blocked);
  useLayoutEffect(() => { blockedNow.current = blocked; }, [blocked]);
  const pending = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, [scope]);

  function persist(next: ReviewState) {
    save(storageKey, next, 'session');
    setReview(next);
  }

  async function run(action: (current: () => boolean) => Promise<void>) {
    if (pending.current) return;
    const token = authSession();
    if (!!state.user !== !!token) {
      setError('로그인 상태를 확인한 뒤 같은 계정에서 다시 시도해 주세요.');
      return;
    }
    const current = () => active.current && authSession() === token;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action(current);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  }

  function preview() {
    return run(async current => {
      persist({ visitId: review.visitId });
      let expectedVersion = state.user?.tasteProfileVersion ?? 1;
      if (profile.version === 2 && state.user) {
        const actor = await api.me();
        if (!current()) return;
        if (actor.id !== state.user.id) throw new Error('현재 로그인 계정을 확인해 주세요.');
        expectedVersion = actor.tasteProfileVersion ?? 1;
      }
      const result: TastePreview = profile.version === 2
        ? await api.resolveTaste(profile, review.visitId, state.exhibitionId!)
        : { tasteProfile: profile, tagOrder: profile.selectedTags, groups: [], userConfirmed: false };
      if (!current()) return;
      if (blockedNow.current) return;
      if (profile.version === 2 && (!result.visitEvidenceReceipt || result.tasteProfile.version !== 2)) {
        throw new Error('관람 취향 근거를 받지 못했어요. 다시 확인해 주세요.');
      }
      persist({ visitId: review.visitId, preview: result, expectedVersion });
    });
  }

  function apply(visitOnly: boolean) {
    return run(async current => {
      const confirmed = review.preview;
      if (!confirmed || (blockedNow.current && !review.mutation)) return;
      const resolved = confirmed.tasteProfile;
      if (sameTaste(state.tasteProfile, resolved) && !review.mutation) {
        navigate(to(state.duration ? '/recommend' : '/time'));
        return;
      }
      if (!review.mutation && state.startedAt &&
          !(await confirm('새 취향으로 관람을 시작하면 현재 진행과 반응이 초기화됩니다. 계속할까요?'))) return;
      if (!current()) return;
      if (blockedNow.current && !review.mutation) return;
      let user: User | undefined;
      if (!visitOnly && saveAccount && state.user) {
        const account = state.user;
        const mutation = review.mutation ?? {
          clientMutationId: newVisitId(), expectedSavedProfileVersion: review.expectedVersion ?? account.tasteProfileVersion ?? 1,
        };
        const attempt = { ...review, mutation };
        persist(attempt);
        try {
          user = await saveConfirmedTaste({
            account, profile: resolved, mutation, acknowledged: !!review.acknowledged, isCurrent: current,
            put: () => api.updateTastes(account.id, resolved.selectedTags, resolved, state.exhibitionId!,
              mutation),
            getUser: api.me,
            onAcknowledged: () => persist({ ...attempt, acknowledged: true }),
          });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && !review.acknowledged && current()) {
            persist({ ...review, mutation: undefined });
          }
          throw e;
        }
        if (!user) return;
      }
      if (!current()) return;
      if (blockedNow.current) {
        if (user) dispatch({ type: 'login', user });
        throw new Error('계정 저장 결과를 확인했어요. 관람에 적용하려면 조사 근거를 다시 확인해 주세요.');
      }
      let receipt = confirmed.visitEvidenceReceipt;
      if (resolved.version === 2) {
        const refreshed = await api.resolveTaste(resolved, review.visitId, state.exhibitionId!);
        if (!current()) return;
        if (blockedNow.current) {
          if (user) dispatch({ type: 'login', user });
          throw new Error('조사 근거를 확인한 뒤 관람에 다시 적용해 주세요.');
        }
        if (!refreshed.visitEvidenceReceipt || !sameTaste(refreshed.tasteProfile, resolved)) {
          throw new Error('관람 취향 근거가 바뀌었어요. 다시 확인해 주세요.');
        }
        receipt = refreshed.visitEvidenceReceipt;
      }
      remove(storageKey, 'session');
      dispatch({ type: 'applyTaste', scope, visitId: review.visitId, profile: resolved,
        receipt, user });
      navigate(to(sameTaste(state.tasteProfile, resolved) && state.duration ? '/recommend' : '/time'));
    });
  }

  function applySaved() {
    return run(async current => {
      const account = state.user;
      if (!account || !state.exhibitionId) return;
      const latest = await api.me();
      if (!current()) return;
      if (latest.id !== account.id) throw new Error('현재 로그인 계정을 확인해 주세요.');
      if ((latest.tasteProfileVersion ?? 1) !== profile.savedProfileVersion ||
          latest.tastes.length !== profile.selectedTags.length ||
          !latest.tastes.every(tag => profile.selectedTags.includes(tag))) {
        throw new Error('저장된 취향이 바뀌었어요. 계정의 최신 취향을 확인해 주세요.');
      }

      let resolved = profile;
      let receipt: string | undefined;
      if (profile.version === 2) {
        const result = await api.resolveTaste(profile, review.visitId, state.exhibitionId);
        if (!current()) return;
        if (!result.visitEvidenceReceipt || !sameTaste({ ...result.tasteProfile, counts: {} }, profile)) {
          throw new Error('저장된 취향의 관람 근거를 확인하지 못했어요. 다시 시도해 주세요.');
        }
        resolved = result.tasteProfile;
        receipt = result.visitEvidenceReceipt;
      }
      if (sameTaste(state.tasteProfile, resolved)) {
        navigate(to(state.duration ? '/recommend' : '/time'));
        return;
      }
      if (state.startedAt && !(await confirm('새 취향으로 관람을 시작하면 현재 진행과 반응이 초기화됩니다. 계속할까요?'))) return;
      if (!current()) return;
      remove(storageKey, 'session');
      dispatch({ type: 'applyTaste', scope, visitId: review.visitId, profile: resolved, receipt });
      navigate(to('/time'));
    });
  }

  function refreshAccountTaste() {
    return run(async current => {
      const user = await api.me();
      if (!current()) return;
      if (user.id !== state.user?.id) throw new Error('현재 로그인 계정을 확인해 주세요.');
      dispatch({ type: 'login', user });
      persist({ visitId: review.visitId });
    });
  }

  if (profile.source === 'saved') {
    return (
      <section className="stack gap-12" aria-label="저장 취향 사용" aria-busy={busy}>
        {error && <p role="alert">{error}</p>}
        <button type="button" className="btn primary block" disabled={busy} onClick={applySaved}>
          {busy ? '확인 중…' : '이 취향으로 관람 시작'}
        </button>
        {error && <button type="button" className="btn outline block" disabled={busy} onClick={refreshAccountTaste}>계정 최신 취향 확인</button>}
      </section>
    );
  }

  const result = review.preview;
  return (
    <section className="stack gap-12" aria-label="취향 확인" aria-busy={busy}>
      {error && <p role="alert">{review.acknowledged ? '계정 저장 응답을 받았어요. ' : ''}{error}</p>}
      {!result ? (
        <button type="button" className="btn primary block" disabled={busy || blocked || !profile.selectedTags.length} onClick={preview}>
          {busy ? '확인 중…' : '취향 미리 확인'}
        </button>
      ) : (
        <>
          <div className="chips" aria-label="추천에 사용할 취향 순서">
            {result.tagOrder.map(tag => <span key={tag} className="chip accent">{TASTE_LABEL[tag]}</span>)}
          </div>
          <button type="button" className="btn primary block" disabled={busy || (blocked && !review.mutation)} onClick={() => apply(false)}>
            {busy ? '확인 중…' : review.acknowledged ? '계정 저장 결과 확인' : review.mutation ? '같은 요청으로 저장 재시도' :
              saveAccount && state.user ? '확인하고 계정에 저장' : '이 취향으로 계속'}
          </button>
          {saveAccount && state.user && !blocked && (
            <button type="button" className="btn outline block" disabled={busy} onClick={() => apply(true)}>
              이번 관람만 적용
            </button>
          )}
          {error && state.user && !review.mutation && (
            <button type="button" className="btn outline block" disabled={busy} onClick={refreshAccountTaste}>계정 최신 취향 확인</button>
          )}
        </>
      )}
    </section>
  );
}

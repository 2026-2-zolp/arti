/** 저장된 취향을 확인하고 재사용하는 화면 */
/** U-06 저장 취향 확인 — 로그인 사용자의 기존 취향을 그대로 쓰거나 수정 */
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { TASTE_LABEL } from '../../data/mock';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionPath, withRedirect } from '../../store/ExhibitionRoute';
import TasteReview from '../../components/TasteReview';
import { tasteScope } from '../../lib/tasteFlow';
import type { TasteProfile, TasteTag } from '../../types';

/** 저장된 취향을 확인하고 재사용하는 화면 */
export default function U06SavedTaste() {
  const navigate = useNavigate();
  const { state } = useVisit();
  const to = useExhibitionPath();
  const user = state.user;
  const [edited, setEdited] = useState<TasteTag[] | null>(null);

  if (!user) return <Navigate to={withRedirect('/login', to('/taste/saved'))} replace />;

  const hasTastes = user.tastes.length > 0;
  const name = user.nickname || user.email.split('@')[0];

  const profile: TasteProfile = {version: user.tasteProfile?.version ?? 1, source: 'saved',
    savedProfileVersion: user.tasteProfileVersion ?? 1, poolVersion: null, picks: [], counts: {}, selectedTags: user.tastes};
  const reviewKey = `arti.tasteDraft.${tasteScope(state)}.saved.${profile.savedProfileVersion}`;
  const manual: TasteProfile = { ...profile, source: 'manual', savedProfileVersion: undefined, selectedTags: edited ?? [] };

  return (
    <MobileShell
      screenId="U-06"
      back={to('/entry')}
      footer={
        <div className="stack gap-10">
          {hasTastes && edited === null && <TasteReview key={reviewKey} storageKey={reviewKey} profile={profile} saveAccount={false} />}
          {edited !== null && edited.length > 0 && (
            <TasteReview key={`${reviewKey}.manual.${edited.join(',')}`} storageKey={`${reviewKey}.manual.${edited.join(',')}`}
              profile={manual} saveAccount={false} />
          )}
          {!hasTastes && <button type="button" className="btn primary block" onClick={() => navigate(to('/taste'))}>취향 고르러 가기</button>}
        </div>
      }
    >
      <Lead
        title={`${name}님의 취향`}
        desc={edited !== null ? '고른 태그는 이번 관람에만 적용해요.' :
          hasTastes ? '저장된 취향을 이번 관람에 바로 쓸 수 있어요.' : '아직 저장된 취향이 없어요. 간단히 골라 볼까요?'}
      />
      {hasTastes && (
        <div className="saved-taste-card">
          <span className="eyebrow">{edited === null ? '저장된 취향 키워드' : '이번 관람에 쓸 취향'}</span>
          <div className="chips" aria-label={edited === null ? '저장된 취향' : '수정할 취향 태그'}>
            {edited === null ? user.tastes.map((t) => (
              <span key={t} className="chip accent">
                {TASTE_LABEL[t]}
              </span>
            )) : (Object.keys(TASTE_LABEL) as TasteTag[]).map(tag => (
              <button type="button" key={tag} aria-pressed={edited.includes(tag)}
                className={`chip ${edited.includes(tag) ? 'accent' : ''}`}
                onClick={() => setEdited(edited.includes(tag) ? edited.filter(t => t !== tag) : [...edited, tag])}>
                {TASTE_LABEL[tag]}
              </button>
            ))}
          </div>
          {edited?.length === 0 && <p>취향 태그를 하나 이상 골라 주세요.</p>}
          <div className="stack gap-10 mt-12">
            <button type="button" className="btn outline block" onClick={() => setEdited(edited === null ? [...user.tastes] : null)}>
              {edited === null ? '태그 수정하기' : '저장된 취향으로 돌아가기'}
            </button>
            <button type="button" className="btn ghost block" onClick={() => navigate(to('/taste'))}>작품 다시 고르기</button>
          </div>
        </div>
      )}
    </MobileShell>
  );
}

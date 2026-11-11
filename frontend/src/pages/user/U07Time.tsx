/** 관람 시간을 선택하는 화면 */
import {useConfirm} from '../../components/Confirmation';
/** U-07 관람 시간 선택 — 시간에 따라 추천 작품 수 결정 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Icon } from '../../components/Icon';
import { DURATION_OPTIONS } from '../../data/mock';
import { useVisit } from '../../store/VisitContext';
import { useExhibitionPath } from '../../store/ExhibitionRoute';
import type { VisitDuration } from '../../types';
import { api } from '../../api/client';
import { authSession, tasteScope } from '../../lib/tasteFlow';
import { newVisitId } from '../../lib/visitScope';

/** 관람 시간을 선택하는 화면 */
export default function U07Time() {
  const confirmAction = useConfirm();
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const to = useExhibitionPath();
  const [value, setValue] = useState<VisitDuration | null>(state.duration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = tasteScope(state);
  const currentScope = useRef<string | null>(null);
  const pending = useRef(false);
  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => { currentScope.current = null; };
  }, [scope]);

  // 취향 선택(양자택일 또는 저장된 태그) 없이 직접 들어온 경우 취향 화면으로 돌려보낸다
  if (!state.tasteDone && state.tastes.length === 0) return <Navigate to={to('/taste')} replace />;

  const next = async () => {
    if (!value || pending.current) return;
    // 같은 시간으로 돌아가면 기존 추천·반응·관람 ID를 그대로 이어갑니다.
    if (value === state.duration) {
      navigate(to('/recommend'));
      return;
    }
    const token = authSession();
    const current = () => currentScope.current === scope && authSession() === token;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (state.startedAt && !(await confirmAction('추천을 다시 받으면 현재 관람 진행과 반응이 초기화됩니다. 새 관람을 시작할까요?'))) return;
      if (!current()) return;
      let proof: {visitId: string; receipt: string} | undefined;
      if (state.startedAt && state.tasteProfile?.version === 2) {
        const visitId = newVisitId();
        const result = await api.resolveTaste(state.tasteProfile, visitId, state.exhibitionId!);
        if (!result.visitEvidenceReceipt) throw new Error('새 관람의 취향 근거를 받지 못했어요.');
        proof = { visitId, receipt: result.visitEvidenceReceipt };
      }
      if (!current()) return;
      dispatch({ type: 'setDuration', duration: value, newVisit: !!state.startedAt, scope, proof });
      navigate(to('/recommend'));
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : '관람 시간을 다시 확인해 주세요.');
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };

  return (
    <MobileShell
      screenId="U-07"
      title="관람 시간"
      footer={
        <button className="btn primary block" disabled={!value || busy} onClick={next}>
          추천 받기
        </button>
      }
    >
      <Lead title="얼마나 관람할 수 있나요?" desc="시간에 맞춰 추천 작품 수와 관람 순서를 정해 드려요." />
      {error && <p role="alert">{error}</p>}

      <div className="stack gap-12" role="radiogroup" aria-label="관람 시간">
        {DURATION_OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              className={`option-row ${on ? 'on' : ''}`}
              onClick={() => setValue(o.value)}
            >
              <Icon name="clock" />
              <span className="option-text">
                <strong>{o.label}</strong>
                <span>{o.desc}</span>
              </span>
              <span className="option-count">{o.count}점</span>
            </button>
          );
        })}
      </div>
    </MobileShell>
  );
}

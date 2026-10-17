/** U-07 관람 시간 선택 — 시간에 따라 추천 작품 수 결정 */
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { Icon } from '../../components/Icon';
import { DURATION_OPTIONS } from '../../data/mock';
import { useVisit } from '../../store/VisitContext';
import type { VisitDuration } from '../../types';

export default function U07Time() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  const [value, setValue] = useState<VisitDuration | null>(state.duration);

  // 취향 정보 없이 직접 들어온 경우 취향 화면으로 돌려보낸다
  if (state.tastes.length === 0) return <Navigate to="/taste" replace />;

  const next = () => {
    if (!value) return;
    dispatch({ type: 'setDuration', duration: value });
    dispatch({ type: 'setRecommendations', recs: [] }); // 조건이 바뀌었으니 U-08에서 새로 추천
    navigate('/recommend');
  };

  return (
    <MobileShell
      screenId="U-07"
      title="관람 시간"
      footer={
        <button className="btn primary block" disabled={!value} onClick={next}>
          추천 받기
        </button>
      }
    >
      <Lead title="얼마나 관람할 수 있나요?" desc="시간에 맞춰 추천 작품 수와 관람 순서를 정해 드려요." />

      <div className="stack gap-12" role="radiogroup" aria-label="관람 시간">
        {DURATION_OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
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

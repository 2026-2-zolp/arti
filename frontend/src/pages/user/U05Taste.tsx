/** U-05 취향 파악 — 작품/시각적 특성 카드 다중 선택 (2개 이상) */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lead, MobileShell } from '../../components/MobileShell';
import { ArtImage } from '../../components/ArtImage';
import { Icon } from '../../components/Icon';
import { TASTE_LABEL, TASTE_SAMPLES } from '../../data/mock';
import { api } from '../../api/client';
import { useVisit } from '../../store/VisitContext';
import type { TasteTag } from '../../types';

const MIN_SELECT = 2;

export default function U05Taste() {
  const navigate = useNavigate();
  const { state, dispatch } = useVisit();
  // "취향 수정하기"로 들어온 경우 기존 선택을 미리 체크해 둔다
  const [selected, setSelected] = useState<TasteTag[]>(state.tastes);

  const toggle = (tag: TasteTag) =>
    setSelected((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));

  const done = async () => {
    dispatch({ type: 'setTastes', tastes: selected });
    if (state.user) {
      // 로그인 사용자는 다음 관람을 위해 취향을 계정에 저장
      await api.updateTastes(state.user.id, selected);
      dispatch({ type: 'login', user: { ...state.user, tastes: selected } });
    }
    navigate('/time');
  };

  const ready = selected.length >= MIN_SELECT;

  return (
    <MobileShell
      screenId="U-05"
      title="취향 파악"
      footer={
        <button className="btn primary block" disabled={!ready} onClick={done}>
          {ready ? `선택 완료 (${selected.length})` : '선택 완료'}
        </button>
      }
    >
      <Lead title="더 끌리는 작품을 골라주세요" desc="장르명을 몰라도 괜찮아요. 선택 결과로 취향을 파악합니다." />

      <div className="taste-grid">
        {TASTE_SAMPLES.map(({ tag, palette }) => {
          const on = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={`taste-card ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => toggle(tag)}
            >
              <ArtImage seed={`taste-${tag}`} palette={palette} alt={TASTE_LABEL[tag]} ratio={4 / 3} />
              <span className="taste-card-foot">
                <span>{TASTE_LABEL[tag]}</span>
                <span className="check-circle">{on && <Icon name="check" size={14} />}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="muted small mt-12">
        {MIN_SELECT}개 이상 선택 {selected.length > 0 && `· ${selected.length}개 선택됨`}
      </p>
    </MobileShell>
  );
}

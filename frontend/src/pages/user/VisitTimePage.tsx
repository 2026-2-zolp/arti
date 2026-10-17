import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, CardButton } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useExhibitionSession } from '@/contexts/VisitSessionContext';
import { useExhibitionId } from '@/hooks/useRouteParams';
import { paths } from '@/routes/paths';
import type { VisitTimeOption } from '@/types/domain';
import common from './common.module.css';
import styles from './VisitTimePage.module.css';

const OPTIONS: { value: VisitTimeOption; label: string; description: string }[] = [
  { value: '30m', label: '30분', description: '핵심 작품 위주로 빠르게' },
  { value: '1h', label: '1시간', description: '추천 작품을 여유 있게' },
  { value: 'free', label: '여유롭게', description: '시간 제한 없이 충분히' },
];

/** U-07 관람 시간 선택 */
export function VisitTimePage() {
  const exhibitionId = useExhibitionId();
  const navigate = useNavigate();
  const { session, setTimeOption } = useExhibitionSession(exhibitionId, { ensure: true });
  const [selected, setSelected] = useState<VisitTimeOption>(session?.timeOption ?? '1h');

  return (
    <MobileLayout
      title="관람 시간"
      backFallback={paths.taste(exhibitionId)}
      footer={
        <Button
          fullWidth
          onClick={() => {
            setTimeOption(selected);
            navigate(paths.recommendations(exhibitionId));
          }}
        >
          추천 받기
        </Button>
      }
    >
      <PageIntro
        title="오늘 얼마나 관람할까요?"
        description="선택한 시간에 맞춰 추천 작품 수와 관람 순서를 구성합니다."
      />

      <div className={common.stack} role="radiogroup" aria-label="관람 시간">
        {OPTIONS.map((option) => {
          const isSelected = selected === option.value;
          return (
            <CardButton
              key={option.value}
              padding="lg"
              selected={isSelected}
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(option.value)}
              className={styles.option}
            >
              <span className={`${styles.radio} ${isSelected ? styles.radioOn : ''}`} />
              <span>
                <span className={styles.label}>{option.label}</span>
                <span className={styles.description}>{option.description}</span>
              </span>
            </CardButton>
          );
        })}
      </div>
    </MobileLayout>
  );
}

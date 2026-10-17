import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, CardButton, Icon, QueryState, Skeleton, useToast } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useExhibitionSession } from '@/contexts/VisitSessionContext';
import { useSaveMyTaste, useTasteOptions } from '@/hooks/queries/useUserQueries';
import { useExhibitionId } from '@/hooks/useRouteParams';
import { paths } from '@/routes/paths';
import common from './common.module.css';
import styles from './TastePage.module.css';

const MIN_SELECT = 2;

/** U-05 취향 파악 — 작품/특성 카드 다중 선택 (2개 이상) */
export function TastePage() {
  const exhibitionId = useExhibitionId();
  const navigate = useNavigate();
  const toast = useToast();
  const { isLoggedIn } = useAuth();
  const { session, setTastes } = useExhibitionSession(exhibitionId, { ensure: true });
  const query = useTasteOptions(exhibitionId);
  const saveTaste = useSaveMyTaste();

  const [selected, setSelected] = useState<string[]>(() => session?.tasteIds ?? []);

  const toggle = (tasteId: string) =>
    setSelected((prev) =>
      prev.includes(tasteId) ? prev.filter((id) => id !== tasteId) : [...prev, tasteId],
    );

  const handleComplete = () => {
    const options = query.data ?? [];
    const keywords = options.filter((o) => selected.includes(o.tasteId)).flatMap((o) => o.keywords);
    setTastes(selected, keywords);
    if (isLoggedIn) {
      // 로그인 사용자는 다음 관람에서 재사용할 수 있도록 저장 (실패해도 관람은 계속)
      saveTaste.mutate(selected, {
        onError: () => toast.error('취향 저장에 실패했어요. 이번 관람에는 그대로 사용돼요.'),
      });
    }
    navigate(paths.visitTime(exhibitionId));
  };

  return (
    <MobileLayout
      title="취향 파악"
      backFallback={paths.start(exhibitionId)}
      footer={
        <Button fullWidth disabled={selected.length < MIN_SELECT} onClick={handleComplete}>
          선택 완료
        </Button>
      }
    >
      <PageIntro
        title="더 끌리는 작품을 골라주세요"
        description="장르명을 몰라도 괜찮아요. 선택 결과로 취향을 파악합니다."
      />

      <QueryState
        query={query}
        loading={
          <div className={styles.grid}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} height={220} radius={16} />
            ))}
          </div>
        }
      >
        {(options) => (
          <>
            <div className={styles.grid} role="group" aria-label="취향 선택">
              {options.map((option) => {
                const isSelected = selected.includes(option.tasteId);
                return (
                  <CardButton
                    key={option.tasteId}
                    padding="none"
                    selected={isSelected}
                    className={styles.card}
                    onClick={() => toggle(option.tasteId)}
                    aria-pressed={isSelected}
                  >
                    <img src={option.imageUrl} alt="" className={styles.image} />
                    <span className={styles.footer}>
                      <span className={styles.label}>{option.label}</span>
                      <span className={`${styles.check} ${isSelected ? styles.checked : ''}`}>
                        {isSelected && <Icon name="check" size={16} strokeWidth={2.4} />}
                      </span>
                    </span>
                  </CardButton>
                );
              })}
            </div>
            <p className={`${common.hint} ${styles.counter}`}>
              {MIN_SELECT}개 이상 선택 {selected.length > 0 && `· ${selected.length}개 선택됨`}
            </p>
          </>
        )}
      </QueryState>
    </MobileLayout>
  );
}

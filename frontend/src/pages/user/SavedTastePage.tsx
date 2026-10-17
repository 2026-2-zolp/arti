import { useNavigate } from 'react-router-dom';
import { Button, Card, Chip, EmptyState, QueryState, Skeleton } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useExhibitionSession } from '@/contexts/VisitSessionContext';
import { useMyTaste } from '@/hooks/queries/useUserQueries';
import { useExhibitionId } from '@/hooks/useRouteParams';
import { paths } from '@/routes/paths';
import common from './common.module.css';
import styles from './SavedTastePage.module.css';

/** U-06 저장 취향 확인 (로그인 필요) */
export function SavedTastePage() {
  const exhibitionId = useExhibitionId();
  const navigate = useNavigate();
  const { setTastes } = useExhibitionSession(exhibitionId, { ensure: true });
  const query = useMyTaste();

  return (
    <MobileLayout title="내 취향 확인" backFallback={paths.start(exhibitionId)}>
      <PageIntro
        title="저장된 취향을 불러왔어요"
        description="이번 관람에서도 그대로 사용하거나 간단히 수정할 수 있습니다."
      />

      <QueryState
        query={query}
        loading={<Skeleton height={300} radius={20} />}
        empty={
          <EmptyState
            title="아직 저장된 취향이 없어요"
            description="간단한 작품 선택으로 취향을 알려주세요."
            action={
              <Button fullWidth onClick={() => navigate(paths.taste(exhibitionId))}>
                취향 선택하기
              </Button>
            }
          />
        }
      >
        {(taste) => (
          <div className={common.stack}>
            <Card tone="accent" padding="lg" className={styles.card}>
              <p className={styles.label}>현재 취향</p>
              <div className={styles.chips}>
                {taste!.keywords.map((keyword) => (
                  <Chip key={keyword}>{keyword}</Chip>
                ))}
              </div>
            </Card>

            <div className={`${common.stackSm} ${styles.actions}`}>
              <Button
                fullWidth
                onClick={() => {
                  setTastes(taste!.tasteIds, taste!.keywords);
                  navigate(paths.visitTime(exhibitionId));
                }}
              >
                이 취향으로 계속
              </Button>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setTastes(taste!.tasteIds, taste!.keywords);
                  navigate(paths.taste(exhibitionId));
                }}
              >
                취향 수정하기
              </Button>
            </div>
          </div>
        )}
      </QueryState>
    </MobileLayout>
  );
}

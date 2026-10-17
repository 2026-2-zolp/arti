import { useNavigate } from 'react-router-dom';
import {
  Button,
  CardButton,
  Chip,
  EmptyState,
  Icon,
  QueryState,
  SkeletonList,
} from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useMyVisits } from '@/hooks/queries/useUserQueries';
import { paths } from '@/routes/paths';
import { formatDate } from '@/utils/format';
import common from './common.module.css';
import styles from './HistoryPage.module.css';

/** U-13 관람기록 (로그인 필요 — 미로그인 시 U-03 인증 후 복귀) */
export function HistoryPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const query = useMyVisits();

  return (
    <MobileLayout
      title="내 관람기록"
      backFallback={paths.root}
      headerRight={
        <button
          type="button"
          className={common.headerLink}
          onClick={async () => {
            // 먼저 이동해야 RequireAuth 가 로그인 화면으로 보내지 않는다
            navigate(paths.root, { replace: true });
            await logout();
          }}
        >
          로그아웃
        </button>
      }
    >
      <PageIntro
        title="지난 관람을 다시 만나보세요"
        description="로그인 사용자에게 저장된 관람 기록입니다."
      />

      <QueryState
        query={query}
        loading={<SkeletonList count={3} itemHeight={176} />}
        empty={
          <EmptyState
            icon="history"
            title="아직 저장된 관람 기록이 없어요"
            description="관람을 마치면 아트 영수증이 이곳에 저장돼요."
            action={
              <Button fullWidth onClick={() => navigate(paths.root)}>
                관람 시작하기
              </Button>
            }
          />
        }
      >
        {(visits) => (
          <ul className={styles.list}>
            {visits.map((visit) => (
              <li key={visit.visitId}>
                <CardButton
                  padding="md"
                  className={styles.card}
                  onClick={() => navigate(paths.historyDetail(visit.visitId))}
                >
                  <img src={visit.thumbnailUrl} alt="" className={styles.thumb} />
                  <span className={styles.body}>
                    <span className={styles.title}>{visit.venue}</span>
                    <span className={styles.date}>{formatDate(visit.visitedAt)}</span>
                    <span className={styles.meta}>
                      {visit.viewedCount}개 작품 · {visit.durationMinutes}분
                    </span>
                    <Chip tone="accent" size="sm">
                      아트 영수증
                    </Chip>
                  </span>
                  <Icon name="chevronRight" className={styles.chevron} strokeWidth={1.4} />
                </CardButton>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </MobileLayout>
  );
}

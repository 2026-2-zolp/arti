import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Icon, QueryState, Skeleton } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useExhibitionSession } from '@/contexts/VisitSessionContext';
import { useExhibition } from '@/hooks/queries/useUserQueries';
import { hasAppHistory, useExhibitionId } from '@/hooks/useRouteParams';
import { paths } from '@/routes/paths';
import { formatPeriod } from '@/utils/format';
import common from './common.module.css';
import styles from './ExhibitionStartPage.module.css';

/** U-01 서비스 시작 — 전시 입구 QR / 전시 URL 진입 화면 (/exhibition/:exhibitionId) */
export function ExhibitionStartPage() {
  const exhibitionId = useExhibitionId();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const { session, startSession } = useExhibitionSession(exhibitionId);
  const query = useExhibition(exhibitionId);

  const canResume = session?.status === 'in_progress' && session.recommendations.length > 0;

  const handleStart = () => {
    startSession(exhibitionId);
    navigate(paths.start(exhibitionId));
  };

  return (
    <MobileLayout
      title="ARTI"
      showBack={hasAppHistory()}
      headerRight={
        isLoggedIn && (
          <Link to={paths.history} className={common.headerLink}>
            <Icon name="history" size={16} />
            관람기록
          </Link>
        )
      }
      footer={
        query.isSuccess && (
          <>
            {canResume && (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => navigate(paths.route(exhibitionId))}
              >
                이어서 관람하기 ({session.currentIndex + 1}/{session.recommendations.length})
              </Button>
            )}
            <Button fullWidth onClick={handleStart}>
              관람 시작하기
            </Button>
            <p className={common.caption}>입구 QR 또는 전시 URL로 접속</p>
          </>
        )
      }
    >
      <PageIntro
        align="center"
        title="나만의 시선으로 만나는 미술관"
        description="AI가 추천하고, 작품을 보는 방법까지 안내합니다."
      />

      <div className={styles.hero} aria-hidden="true">
        <span className={`${styles.frame} ${styles.frameLeft}`} />
        <span className={`${styles.frame} ${styles.frameRight}`} />
        <span className={styles.person}>
          <span className={styles.head} />
          <span className={styles.bodyShape} />
        </span>
        <span className={styles.floor} />
      </div>

      <QueryState
        query={query}
        loading={
          <div className={styles.info}>
            <Skeleton width={60} height={14} />
            <Skeleton width="70%" height={22} />
          </div>
        }
        errorTitle="전시 정보를 찾을 수 없어요"
        errorAction={
          <Button variant="text" onClick={() => navigate(paths.root)}>
            기본 전시로 이동
          </Button>
        }
      >
        {(exhibition) => (
          <div className={styles.info}>
            <p className={styles.label}>현재 전시</p>
            <p className={styles.title}>{exhibition.subtitle || exhibition.title}</p>
            <p className={styles.meta}>
              {exhibition.venue} · {exhibition.place} ·{' '}
              {formatPeriod(exhibition.startDate, exhibition.endDate)}
            </p>
            {exhibition.status !== 'active' && (
              <Card tone="muted" padding="sm" className={styles.notice}>
                {exhibition.status === 'closed'
                  ? '종료된 전시예요. 기록 확인용으로만 이용할 수 있어요.'
                  : '아직 시작하지 않은 전시예요.'}
              </Card>
            )}
          </div>
        )}
      </QueryState>
    </MobileLayout>
  );
}

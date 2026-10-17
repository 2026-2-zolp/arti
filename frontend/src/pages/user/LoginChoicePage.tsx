import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useExhibitionSession } from '@/contexts/VisitSessionContext';
import { useExhibitionId } from '@/hooks/useRouteParams';
import { paths, withQuery } from '@/routes/paths';
import { buildLoginUrl } from '@/utils/returnUrl';
import common from './common.module.css';
import styles from './LoginChoicePage.module.css';

/** U-02 로그인 선택 — 로그인 / 비회원 / 회원가입 */
export function LoginChoicePage() {
  const exhibitionId = useExhibitionId();
  const navigate = useNavigate();
  const { user, isLoggedIn } = useAuth();
  useExhibitionSession(exhibitionId, { ensure: true });

  return (
    <MobileLayout title="시작하기" backFallback={paths.exhibition(exhibitionId)}>
      <PageIntro
        title="로그인하고 이용하시겠어요?"
        description={
          <>
            로그인하면 저장된 취향과 관람 기록을 불러올 수 있습니다.
            <br />
            비회원도 핵심 관람 기능을 이용할 수 있습니다.
          </>
        }
      />

      <div className={common.stack}>
        <Card tone="accent" padding="lg">
          <div className={styles.row}>
            <Icon name="user" size={40} className={styles.userIcon} strokeWidth={1.6} />
            <div>
              <p className={common.cardTitle}>
                {isLoggedIn ? `${user?.nickname}님` : '기존 사용자'}
              </p>
              <p className={common.cardText}>
                {isLoggedIn
                  ? '로그인되어 있어요. 저장된 취향을 불러올게요.'
                  : '저장된 취향과 이전 관람 기록 활용'}
              </p>
            </div>
          </div>
          <Button
            fullWidth
            className={styles.cardButton}
            onClick={() =>
              navigate(
                isLoggedIn
                  ? paths.savedTaste(exhibitionId)
                  : buildLoginUrl(paths.savedTaste(exhibitionId), paths.login),
              )
            }
          >
            {isLoggedIn ? '저장된 취향으로 계속' : '로그인'}
          </Button>
        </Card>

        <Card tone="muted" padding="lg">
          <p className={common.cardTitle}>처음 이용하거나 로그인하지 않기</p>
          <p className={common.cardText}>간단한 취향 파악 후 바로 관람을 시작합니다.</p>
          <Button
            variant="secondary"
            fullWidth
            className={styles.cardButton}
            onClick={() => navigate(paths.taste(exhibitionId))}
          >
            {isLoggedIn ? '취향 새로 선택하기' : '비회원으로 계속'}
          </Button>
        </Card>
      </div>

      {!isLoggedIn && (
        <p className={common.linkRow}>
          계정이 없나요?
          <Link to={withQuery(paths.signup, { returnUrl: paths.taste(exhibitionId) })}>
            회원가입
          </Link>
        </p>
      )}
    </MobileLayout>
  );
}

import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Icon, useToast } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { ArtReceipt } from '@/components/receipt/ArtReceipt';
import { useAuth } from '@/contexts/AuthContext';
import { useExhibitionSession, type VisitSessionState } from '@/contexts/VisitSessionContext';
import { useExhibition, useSaveVisit } from '@/hooks/queries/useUserQueries';
import { useExhibitionId } from '@/hooks/useRouteParams';
import { paths } from '@/routes/paths';
import type { VisitRecord } from '@/types/domain';
import { formatDate } from '@/utils/format';
import { buildLoginUrl } from '@/utils/returnUrl';
import common from './common.module.css';
import styles from './ReceiptPage.module.css';

function summarize(session: VisitSessionState) {
  const end = session.endedAt ? new Date(session.endedAt) : new Date();
  const durationMinutes = Math.max(
    1,
    Math.round((end.getTime() - new Date(session.startedAt).getTime()) / 60000),
  );
  const viewed = session.recommendations.filter((r) =>
    session.viewedArtworkIds.includes(r.artworkId),
  );
  const longest = [...viewed].sort(
    (a, b) => (session.viewSeconds[b.artworkId] ?? 0) - (session.viewSeconds[a.artworkId] ?? 0),
  )[0];
  return {
    durationMinutes,
    viewedCount: viewed.length,
    recommendedCount: session.recommendations.length,
    reactionCount: Object.keys(session.reactions).length,
    longestViewedTitle: longest?.title ?? null,
    tasteKeywords: session.tasteKeywords,
    artworks: viewed.map((r) => ({
      artworkId: r.artworkId,
      title: r.title,
      imageUrl: r.imageUrl,
      reaction: session.reactions[r.artworkId] ?? null,
      viewedSeconds: session.viewSeconds[r.artworkId] ?? 0,
    })),
  };
}

/** U-12 아트 영수증 (현재 관람) — 관람 완료 시 세션 종료 */
export function ReceiptPage() {
  const exhibitionId = useExhibitionId();
  const navigate = useNavigate();
  const toast = useToast();
  const { isLoggedIn } = useAuth();
  const { session, clear, setSavedVisitId } = useExhibitionSession(exhibitionId);
  const exhibition = useExhibition(exhibitionId);
  const saveVisit = useSaveVisit();
  const savingRef = useRef(false);

  const summary = useMemo(() => (session ? summarize(session) : null), [session]);
  const completed = session?.status === 'completed';

  // 로그인 사용자는 관람 기록을 서버에 저장 (로그인 전환 후 돌아와도 저장)
  useEffect(() => {
    if (!session || !summary || !completed || !isLoggedIn || session.savedVisitId) return;
    if (!exhibition.data || savingRef.current) return;
    savingRef.current = true;
    const record: Omit<VisitRecord, 'visitId'> = {
      sessionId: session.sessionId,
      exhibitionId,
      exhibitionTitle: exhibition.data.title,
      venue: exhibition.data.venue,
      visitedAt: session.startedAt,
      thumbnailUrl: session.recommendations[0]?.imageUrl ?? '',
      ...summary,
    };
    saveVisit.mutate(record, {
      onSuccess: (saved) => setSavedVisitId(saved.visitId),
      onError: () => {
        savingRef.current = false;
      },
    });
  }, [
    session,
    summary,
    completed,
    isLoggedIn,
    exhibition.data,
    exhibitionId,
    saveVisit,
    setSavedVisitId,
  ]);

  if (!session || !summary || session.viewedArtworkIds.length === 0) {
    return (
      <MobileLayout title="아트 영수증" backFallback={paths.exhibition(exhibitionId)}>
        <EmptyState
          title="아직 완료된 관람이 없어요"
          description="작품 감상을 마치면 오늘의 관람 결과를 영수증으로 보여드려요."
          action={
            <Button fullWidth onClick={() => navigate(paths.exhibition(exhibitionId))}>
              관람 시작하기
            </Button>
          }
        />
      </MobileLayout>
    );
  }

  const handleComplete = () => {
    clear();
    toast.success('오늘의 관람을 마쳤어요');
    navigate(paths.exhibition(exhibitionId), { replace: true });
  };

  return (
    <MobileLayout
      title="아트 영수증"
      backFallback={paths.route(exhibitionId)}
      footer={
        <Button fullWidth onClick={handleComplete}>
          관람 완료
        </Button>
      }
    >
      <PageIntro
        align="center"
        title="오늘의 관람이 완성됐어요"
        description={`${formatDate(session.startedAt)} · 관람 ${summary.durationMinutes}분`}
      />

      <ArtReceipt data={summary} />

      <div className={styles.saveStatus}>
        {isLoggedIn ? (
          <p className={styles.saved}>
            {saveVisit.isPending && '관람 기록을 저장하고 있어요…'}
            {session.savedVisitId && (
              <>
                <Icon name="check" size={16} /> 관람 기록에 저장되었어요
              </>
            )}
            {saveVisit.isError && (
              <>
                기록 저장에 실패했어요.{' '}
                <button
                  type="button"
                  className={styles.retry}
                  onClick={() => {
                    saveVisit.reset();
                    savingRef.current = false;
                    setSavedVisitId('');
                  }}
                >
                  다시 시도
                </button>
              </>
            )}
          </p>
        ) : (
          <Card tone="info" padding="md">
            <p className={common.cardTitle}>이번 관람 기록을 저장할까요?</p>
            <p className={common.cardText}>
              로그인하면 아트 영수증을 관람기록에서 다시 볼 수 있어요.
            </p>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              className={styles.loginButton}
              onClick={() => navigate(buildLoginUrl(paths.receipt(exhibitionId), paths.login))}
            >
              로그인하고 기록 저장
            </Button>
          </Card>
        )}
      </div>
    </MobileLayout>
  );
}

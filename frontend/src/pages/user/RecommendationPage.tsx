import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { queryKeys } from '@/api/queryKeys';
import {
  Button,
  CardButton,
  Chip,
  EmptyState,
  Icon,
  Modal,
  QueryState,
  SkeletonList,
} from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { useExhibitionSession } from '@/contexts/VisitSessionContext';
import { useRecommendations } from '@/hooks/queries/useUserQueries';
import { useExhibitionId } from '@/hooks/useRouteParams';
import { paths } from '@/routes/paths';
import type { RecommendedArtwork } from '@/types/domain';
import styles from './RecommendationPage.module.css';

/** U-08 개인화 작품 추천 — 취향 + 관람 시간 기반 */
export function RecommendationPage() {
  const exhibitionId = useExhibitionId();
  const navigate = useNavigate();
  const { session, setRecommendations } = useExhibitionSession(exhibitionId);
  const sessionTasteIds = session?.tasteIds;
  const tasteIds = useMemo(() => sessionTasteIds ?? [], [sessionTasteIds]);
  const timeOption = session?.timeOption ?? null;
  const query = useRecommendations(exhibitionId, tasteIds, timeOption);
  const [detail, setDetail] = useState<RecommendedArtwork | null>(null);

  // 추천 결과를 관람 세션에 저장 (U-09 로 넘길 데이터: 합의 9)
  useEffect(() => {
    if (!query.data || !timeOption) return;
    const key = queryKeys.recommendations.list(exhibitionId, tasteIds, timeOption).join('|');
    setRecommendations(query.data.items, key, query.data.tasteKeywords);
  }, [query.data, exhibitionId, tasteIds, timeOption, setRecommendations]);

  const missingStep = !session || tasteIds.length === 0 ? 'taste' : !timeOption ? 'time' : null;
  const count = query.data?.items.length ?? 0;

  return (
    <MobileLayout
      title="추천 작품"
      backFallback={paths.visitTime(exhibitionId)}
      footer={
        !missingStep &&
        count > 0 && (
          <Button fullWidth onClick={() => navigate(paths.route(exhibitionId))}>
            2D 지도에서 경로 보기
          </Button>
        )
      }
    >
      {missingStep ? (
        <EmptyState
          title={
            missingStep === 'taste' ? '취향을 먼저 알려주세요' : '관람 시간을 먼저 선택해 주세요'
          }
          description="취향과 관람 시간을 바탕으로 작품을 추천해 드려요."
          action={
            <Button
              fullWidth
              onClick={() =>
                navigate(
                  missingStep === 'taste'
                    ? paths.taste(exhibitionId)
                    : paths.visitTime(exhibitionId),
                )
              }
            >
              {missingStep === 'taste' ? '취향 선택하기' : '관람 시간 선택하기'}
            </Button>
          }
        />
      ) : (
        <>
          <PageIntro
            title="오늘은 이 작품들을 만나보세요"
            description={
              query.isSuccess
                ? `취향과 관람 시간을 바탕으로 ${count}개 작품을 골랐습니다.`
                : '취향과 관람 시간을 바탕으로 작품을 고르고 있어요.'
            }
          />
          <QueryState
            query={query}
            loading={<SkeletonList count={4} itemHeight={156} />}
            isEmpty={(data) => data.items.length === 0}
            empty={
              <EmptyState
                title="추천할 작품을 찾지 못했어요"
                description="다른 취향을 선택해 보세요."
                action={
                  <Button fullWidth onClick={() => navigate(paths.taste(exhibitionId))}>
                    취향 다시 선택하기
                  </Button>
                }
              />
            }
          >
            {(data) => (
              <ol className={styles.list}>
                {data.items.map((item) => (
                  <li key={item.artworkId}>
                    <CardButton
                      padding="sm"
                      className={styles.card}
                      onClick={() => setDetail(item)}
                    >
                      <img src={item.imageUrl} alt="" className={styles.thumb} />
                      <span className={styles.body}>
                        <span className={styles.title}>
                          {item.order}. {item.title}
                        </span>
                        <span className={styles.artist}>{item.artist}</span>
                        <span className={styles.reason}>{item.recommendationReason}</span>
                      </span>
                      <Icon name="chevronRight" className={styles.chevron} strokeWidth={1.4} />
                    </CardButton>
                  </li>
                ))}
              </ol>
            )}
          </QueryState>
        </>
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.title} sheet>
        {detail && (
          <div className={styles.detail}>
            <img src={detail.imageUrl} alt={detail.title} className={styles.detailImage} />
            <p className={styles.artist}>
              {detail.artist} · {detail.roomName}
            </p>
            <div>
              <Chip tone="accent" size="sm">
                추천 이유
              </Chip>
              <p className={styles.detailReason}>{detail.recommendationReason}</p>
            </div>
            <p className={styles.detailOrder}>관람 순서 {detail.order}번째</p>
          </div>
        )}
      </Modal>
    </MobileLayout>
  );
}

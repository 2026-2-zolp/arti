import { useNavigate, useParams } from 'react-router-dom';
import { Button, QueryState, Skeleton } from '@/components/common';
import { MobileLayout, PageIntro } from '@/components/layout/MobileLayout';
import { ArtReceipt } from '@/components/receipt/ArtReceipt';
import { useMyVisit } from '@/hooks/queries/useUserQueries';
import { paths } from '@/routes/paths';
import { formatDate } from '@/utils/format';

/** U-12 아트 영수증 — 과거 기록 조회 모드 (/history/:visitId) */
export function HistoryDetailPage() {
  const { visitId = '' } = useParams();
  const navigate = useNavigate();
  const query = useMyVisit(visitId);

  return (
    <MobileLayout
      title="아트 영수증"
      backFallback={paths.history}
      footer={
        <Button variant="secondary" fullWidth onClick={() => navigate(paths.history)}>
          관람기록 목록
        </Button>
      }
    >
      <QueryState
        query={query}
        loading={<Skeleton height={520} radius={12} />}
        errorTitle="관람 기록을 불러오지 못했어요"
      >
        {(visit) => (
          <>
            <PageIntro
              align="center"
              title={visit.exhibitionTitle}
              description={`${visit.venue} · ${formatDate(visit.visitedAt)} · 관람 ${visit.durationMinutes}분`}
            />
            <ArtReceipt data={visit} />
          </>
        )}
      </QueryState>
    </MobileLayout>
  );
}

import { useNavigate } from 'react-router-dom';
import { Button, EmptyState } from '@/components/common';
import { MobileLayout } from '@/components/layout/MobileLayout';
import { paths } from '@/routes/paths';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <MobileLayout title="ARTI" backFallback={paths.root} align="center">
      <EmptyState
        icon="alert"
        title="페이지를 찾을 수 없어요"
        description="주소가 바뀌었거나 삭제된 페이지예요."
        action={
          <Button fullWidth onClick={() => navigate(paths.root, { replace: true })}>
            처음으로
          </Button>
        }
      />
    </MobileLayout>
  );
}

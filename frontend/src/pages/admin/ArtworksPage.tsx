import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  QueryState,
  Select,
  SkeletonList,
} from '@/components/common';
import { AdminPageHeader, AdminPanel } from '@/components/layout/AdminLayout';
import { useAdminArtworks, useAdminExhibitions } from '@/hooks/queries/useAdminQueries';
import { paths, withQuery } from '@/routes/paths';
import { formatMonthDay } from '@/utils/format';
import admin from './admin.module.css';
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE } from './labels';

/** A-04 작품 관리 목록 (등록·수정 화면으로 진입) */
export function ArtworksPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const exhibitionId = searchParams.get('exhibitionId') ?? '';
  const exhibitions = useAdminExhibitions();
  const query = useAdminArtworks(exhibitionId || undefined);

  const exhibitionTitle = (id: string) =>
    exhibitions.data?.find((e) => e.exhibitionId === id)?.title ?? id;

  return (
    <>
      <AdminPageHeader
        title="작품 관리"
        description="작품 정보와 설명, 출처·참고자료, 검수 상태를 함께 관리합니다."
        actions={
          <Button
            size="md"
            leftIcon={<Icon name="plus" size={18} />}
            onClick={() => navigate(withQuery(paths.adminArtworkNew, { exhibitionId }))}
          >
            작품 등록
          </Button>
        }
      />

      <AdminPanel className={admin.panelMin}>
        <div className={admin.toolbar}>
          <Select
            tone="admin"
            aria-label="전시 필터"
            placeholder="전체 전시"
            value={exhibitionId}
            options={(exhibitions.data ?? []).map((e) => ({
              value: e.exhibitionId,
              label: e.title,
            }))}
            onChange={(e) =>
              setSearchParams(e.target.value ? { exhibitionId: e.target.value } : {}, {
                replace: true,
              })
            }
          />
        </div>

        <QueryState
          query={query}
          loading={<SkeletonList count={5} itemHeight={52} />}
          empty={
            <EmptyState
              title="등록된 작품이 없어요"
              description="‘작품 등록’으로 작품을 추가하세요."
            />
          }
        >
          {(artworks) => (
            <table className={admin.table}>
              <thead>
                <tr>
                  <th style={{ width: '26%' }}>작품명</th>
                  <th style={{ width: '16%' }}>작가</th>
                  <th style={{ width: '18%' }}>전시</th>
                  <th style={{ width: '12%' }}>전시실</th>
                  <th style={{ width: '12%' }}>검수 상태</th>
                  <th style={{ width: '8%' }}>수정일</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {artworks.map((a) => (
                  <tr
                    key={a.artworkId}
                    className={admin.rowClickable}
                    onClick={() => navigate(paths.adminArtworkEdit(a.artworkId))}
                  >
                    <td>{a.title}</td>
                    <td>{a.artist}</td>
                    <td>{exhibitionTitle(a.exhibitionId)}</td>
                    <td>{a.roomName || '-'}</td>
                    <td>
                      <Chip size="sm" tone={REVIEW_STATUS_TONE[a.reviewStatus]}>
                        {REVIEW_STATUS_LABEL[a.reviewStatus]}
                      </Chip>
                    </td>
                    <td>{formatMonthDay(a.updatedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className={admin.linkButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(
                            withQuery(paths.adminMap, {
                              exhibitionId: a.exhibitionId,
                              artworkId: a.artworkId,
                            }),
                          );
                        }}
                      >
                        위치
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
      </AdminPanel>
    </>
  );
}

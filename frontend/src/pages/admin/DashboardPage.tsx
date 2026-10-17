import { QueryState, Skeleton } from '@/components/common';
import { AdminPageHeader, AdminPanel } from '@/components/layout/AdminLayout';
import { useDashboard } from '@/hooks/queries/useAdminQueries';
import { formatMonthDay } from '@/utils/format';
import admin from './admin.module.css';
import styles from './DashboardPage.module.css';

/** A-02 관리자 대시보드 */
export function DashboardPage() {
  const query = useDashboard();

  return (
    <>
      <AdminPageHeader
        title="대시보드"
        description="등록된 전시와 작품, 데이터 검수 상태를 한눈에 확인합니다."
      />
      <QueryState
        query={query}
        loading={
          <div className={styles.stats}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} height={146} radius={20} />
            ))}
          </div>
        }
      >
        {(data) => (
          <>
            <div className={styles.stats}>
              <Stat label="운영 전시" value={data.activeExhibitionCount} sub="현재 MVP 대상" />
              <Stat
                label="등록 작품"
                value={data.artworkCount}
                sub={`검수 완료 ${data.approvedArtworkCount}`}
              />
              <Stat
                label="위치 등록"
                value={data.positionedArtworkCount}
                sub={`미등록 ${data.unpositionedArtworkCount}`}
              />
              <Stat label="검수 대기" value={data.pendingReviewCount} sub="출처 확인 필요" />
            </div>

            <h2 className={styles.sectionTitle}>최근 데이터 상태</h2>
            <AdminPanel className={styles.tablePanel}>
              <table className={admin.table}>
                <thead>
                  <tr>
                    <th style={{ width: '12%' }}>구분</th>
                    <th style={{ width: '34%' }}>이름</th>
                    <th style={{ width: '18%' }}>상태</th>
                    <th style={{ width: '16%' }}>수정일</th>
                    <th>담당</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((row) => (
                    <tr key={`${row.category}-${row.id}`}>
                      <td>{row.category}</td>
                      <td>{row.name}</td>
                      <td>{row.status}</td>
                      <td>{formatMonthDay(row.updatedAt)}</td>
                      <td>{row.manager}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminPanel>
          </>
        )}
      </QueryState>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className={styles.stat}>
      <p className={styles.statLabel}>{label}</p>
      <p className={styles.statValue}>{value}</p>
      <p className={styles.statSub}>{sub}</p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { EmptyState, Input, Modal, QueryState, SkeletonList, Spinner } from '@/components/common';
import { AdminPageHeader, AdminPanel } from '@/components/layout/AdminLayout';
import { useMember, useMembers } from '@/hooks/queries/useAdminQueries';
import { formatDate } from '@/utils/format';
import admin from './admin.module.css';
import { MEMBER_STATUS_LABEL } from './labels';

/** A-06 회원 조회 (MVP 우선순위 낮음) */
export function MembersPage() {
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useMembers(debounced);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => window.clearTimeout(t);
  }, [keyword]);

  return (
    <>
      <AdminPageHeader
        title="회원 조회"
        description="로그인 사용자의 기본 정보와 저장된 관람 기록을 조회합니다. (MVP 우선순위 낮음)"
      />
      <AdminPanel className={admin.panelMin}>
        <div className={admin.toolbar}>
          <Input
            tone="admin"
            type="search"
            aria-label="회원 검색"
            placeholder="이메일 또는 닉네임 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            rightSlot={query.isFetching ? <Spinner size={18} /> : null}
          />
        </div>

        <QueryState
          query={query}
          loading={<SkeletonList count={3} itemHeight={52} />}
          empty={
            <EmptyState
              icon="search"
              title={debounced ? `‘${debounced}’ 검색 결과가 없어요` : '가입한 회원이 없어요'}
            />
          }
        >
          {(members) => (
            <table className={admin.table}>
              <thead>
                <tr>
                  <th style={{ width: '18%' }}>회원 ID</th>
                  <th style={{ width: '18%' }}>닉네임</th>
                  <th style={{ width: '16%' }}>가입일</th>
                  <th style={{ width: '12%' }}>관람 횟수</th>
                  <th style={{ width: '18%' }}>최근 관람</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr
                    key={m.userId}
                    className={`${admin.rowClickable} ${selectedId === m.userId ? admin.rowSelected : ''}`}
                    onClick={() => setSelectedId(m.userId)}
                  >
                    <td>{m.memberCode}</td>
                    <td>{m.nickname}</td>
                    <td>{formatDate(m.joinedAt)}</td>
                    <td>{m.visitCount}</td>
                    <td>{m.lastVisitAt ? formatDate(m.lastVisitAt) : '-'}</td>
                    <td>{MEMBER_STATUS_LABEL[m.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
      </AdminPanel>

      <MemberDetailModal userId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
}

function MemberDetailModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const query = useMember(userId);
  return (
    <Modal open={Boolean(userId)} onClose={onClose} title="회원 상세" size="lg">
      <QueryState query={query}>
        {(member) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <dl className={admin.formGrid} style={{ margin: 0 }}>
              <div>
                <dt className={admin.muted}>회원 ID</dt>
                <dd style={{ margin: 0 }}>{member.memberCode}</dd>
              </div>
              <div>
                <dt className={admin.muted}>이메일</dt>
                <dd style={{ margin: 0 }}>{member.email}</dd>
              </div>
              <div>
                <dt className={admin.muted}>닉네임</dt>
                <dd style={{ margin: 0 }}>{member.nickname}</dd>
              </div>
              <div>
                <dt className={admin.muted}>가입일 · 상태</dt>
                <dd style={{ margin: 0 }}>
                  {formatDate(member.joinedAt)} · {MEMBER_STATUS_LABEL[member.status]}
                </dd>
              </div>
            </dl>
            <h3 style={{ fontSize: 16 }}>관람 기록 ({member.visits.length})</h3>
            {member.visits.length === 0 ? (
              <EmptyState title="저장된 관람 기록이 없어요" />
            ) : (
              <table className={admin.table}>
                <thead>
                  <tr>
                    <th>전시</th>
                    <th>관람일</th>
                    <th>작품 수</th>
                    <th>관람 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {member.visits.map((v) => (
                    <tr key={v.visitId}>
                      <td>{v.exhibitionTitle}</td>
                      <td>{formatDate(v.visitedAt)}</td>
                      <td>{v.viewedCount}</td>
                      <td>{v.durationMinutes}분</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </QueryState>
    </Modal>
  );
}

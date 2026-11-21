import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { api, type AdminMember } from '../../api/client';
import { TASTE_LABEL } from '../../data/mock';
import { formatDateTime } from '../../lib/adminDate';
import { useAsync } from '../../lib/useAsync';
import { ADMIN_PAGE_SIZE, AdminPagination, adminPage } from './AdminPagination';
import { PageHead } from './AdminLayout';

const EMPTY_FILTERS = { q: '', status: '', visits: '' };
const statusLabel = (status: AdminMember['status']) => status === 'active' ? '정상' : '휴면';

export default function A06Members() {
  const [input, setInput] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminMember | null>(null);
  const { data, loading, error, reload } = useAsync(
    () => api.listMembers({ ...filters, offset: (page - 1) * ADMIN_PAGE_SIZE, limit: ADMIN_PAGE_SIZE }),
    [filters, page],
  );
  const pagination = adminPage(data?.total ?? 0, page);
  useEffect(() => {
    if (data && !loading && page > pagination.pages) setPage(pagination.pages);
  }, [data, loading, page, pagination.pages]);

  return (
    <>
      <PageHead title="회원 조회" desc="로그인 사용자의 기본 정보와 저장된 관람 기록을 조회합니다." />
      <form className="a-filters a-member-filters" onSubmit={(event) => {
        event.preventDefault();
        setFilters({ ...input, q: input.q.trim() });
        setPage(1);
      }}>
        <label>
          <span>회원 검색</span>
          <input className="a-search" type="search" value={input.q}
            onChange={event => setInput({ ...input, q: event.target.value })}
            maxLength={100} placeholder="이메일 또는 닉네임" />
        </label>
        <label>
          <span>계정 상태</span>
          <select aria-label="계정 상태" value={input.status} onChange={event => setInput({ ...input, status: event.target.value })}>
            <option value="">전체</option>
            <option value="active">정상</option>
            <option value="dormant">휴면</option>
          </select>
        </label>
        <label>
          <span>관람 기록</span>
          <select aria-label="관람 기록" value={input.visits} onChange={event => setInput({ ...input, visits: event.target.value })}>
            <option value="">전체</option>
            <option value="with">있음</option>
            <option value="without">없음</option>
          </select>
        </label>
        <button className="a-btn" type="submit">검색</button>
        <button className="a-btn" type="button" onClick={() => {
          setInput(EMPTY_FILTERS);
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}>초기화</button>
      </form>
      {loading && <p role="status">회원 목록을 불러오는 중…</p>}
      {error && <p className="error-text" role="alert">{error} <button className="a-btn" type="button" onClick={reload}>회원 목록 다시 불러오기</button></p>}

      <div className="a-card a-members-card">
        <table className="a-table a-members-table" aria-label="회원 목록">
          <thead>
            <tr>
              <th scope="col">회원 ID(이메일)</th>
              <th scope="col">닉네임</th>
              <th scope="col">가입일시</th>
              <th scope="col" className="a-center">관람 횟수</th>
              <th scope="col">최근 관람일</th>
              <th scope="col" className="a-center">계정 상태</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map(member => (
              <tr key={member.id} className="clickable a-member-row" onClick={event => {
                event.currentTarget.querySelector('button')?.focus();
                setSelected(member);
              }}>
                <td className="a-member-email">
                  <span className="a-member-cell-label" aria-hidden="true">회원 ID(이메일)</span>
                  <button type="button" className="text-btn" aria-haspopup="dialog"
                    aria-label={`${member.email} 회원 상세 보기`}>{member.email}</button>
                </td>
                <td><span className="a-member-cell-label" aria-hidden="true">닉네임</span>{member.nickname || '—'}</td>
                <td><span className="a-member-cell-label" aria-hidden="true">가입일시</span>{formatDateTime(member.createdAt)}</td>
                <td className="a-center"><span className="a-member-cell-label" aria-hidden="true">관람 횟수</span>{member.visitCount}</td>
                <td><span className="a-member-cell-label" aria-hidden="true">최근 관람일</span>{member.lastVisit?.slice(0, 10) || '—'}</td>
                <td className="a-center">
                  <span className="a-member-cell-label" aria-hidden="true">계정 상태</span>
                  <span className={`badge ${member.status === 'active' ? 'running' : 'closed'}`}>{statusLabel(member.status)}</span>
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && <tr><td colSpan={6} className="muted center">검색 결과가 없어요.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <AdminPagination page={pagination.page} pages={pagination.pages} total={data.total} onChange={setPage} />}
      {selected && <MemberDetails member={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function MemberDetails({ member, onClose }: {member: AdminMember; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="a-member-dialog" aria-labelledby={title} onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="a-member-dialog-card">
        <header>
          <h2 id={title}>{member.nickname || member.email}</h2>
          <button className="a-btn sm" type="button" onClick={() => dialog.current?.close()}>닫기</button>
        </header>
        <div className="a-member-dialog-body">
          <dl className="a-dl">
            <dt>이메일</dt><dd>{member.email}</dd>
            <dt>가입일시</dt><dd>{formatDateTime(member.createdAt)}</dd>
            <dt>계정 상태</dt><dd>{statusLabel(member.status)}</dd>
            <dt>저장 취향</dt><dd>{member.tastes.length ? member.tastes.map(tag => TASTE_LABEL[tag]).join(', ') : '—'}</dd>
          </dl>
          <MemberVisits userId={member.id} />
        </div>
      </div>
    </dialog>
  );
}

function MemberVisits({userId}: {userId: string}) {
  const {data: visits, loading, error, reload} = useAsync(() => api.listMemberVisits(userId), [userId]);
  return <>
    <h3>관람 기록</h3>
    {loading && <p role="status">관람 기록을 불러오는 중…</p>}
    {error && <p className="error-text" role="alert">{error} <button className="a-btn" type="button" onClick={reload}>관람 기록 다시 불러오기</button></p>}
    <ul className="a-visit-list">
      {visits?.map(visit => <li key={visit.id}>
        <span>{visit.date.slice(0, 10)}</span>
        <span>작품 {visit.viewedArtworkIds.length}점 · {visit.durationMin}분</span>
      </li>)}
      {visits?.length === 0 && <li className="muted">기록 없음</li>}
    </ul>
  </>;
}

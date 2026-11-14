/** A-06 회원 조회 (우선순위 낮음) — 검색 + 행 선택 시 상세(관람 기록) 표시 */
import { useState } from 'react';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { TASTE_LABEL } from '../../data/mock';
import { PageHead } from './AdminLayout';

/** 관리자용 회원 조회 화면 */
export default function A06Members() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: members, loading, error, reload } = useAsync(() => api.listMembers(query), [query]);
  const selected = members?.find((m) => m.id === selectedId);

  return (
    <>
      <PageHead title="회원 조회" desc="로그인 사용자의 기본 정보와 저장된 관람 기록을 조회합니다." />
      <form
        className="a-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setSelectedId(null);
          if (query === input) reload();
          else setQuery(input);
        }}
      >
        <input
          className="a-search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="이메일 또는 닉네임 검색"
          aria-label="회원 검색"
        />
        <button className="a-btn">검색</button>
      </form>
      {loading && <p role="status">회원 목록을 불러오는 중…</p>}
      {error && <p className="error-text" role="alert">{error} <button className="a-btn" onClick={reload}>회원 목록 다시 불러오기</button></p>}

      <div className="a-two-col wide-left">
        <div className="a-card">
          <table className="a-table">
            <thead>
              <tr>
                <th>회원 ID(이메일)</th>
                <th>닉네임</th>
                <th>가입일</th>
                <th>관람 횟수</th>
                <th>최근 관람일</th>
                <th>계정 상태</th>
              </tr>
            </thead>
            <tbody>
              {members?.map((m) => (
                <tr key={m.id} className={`clickable ${m.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(m.id)}>
                  <td><button className="text-btn" onClick={() => setSelectedId(m.id)} aria-label={`${m.email} 관람 기록 보기`}>{m.email}</button></td>
                  <td>{m.nickname || '-'}</td>
                  <td>{m.createdAt}</td>
                  <td>{m.visitCount}</td>
                  <td>{m.lastVisit ? m.lastVisit.slice(0, 10) : '-'}</td>
                  <td>
                    <span className={`badge ${m.status === 'active' ? 'running' : 'closed'}`}>
                      {m.status === 'active' ? '정상' : '휴면'}
                    </span>
                  </td>
                </tr>
              ))}
              {members?.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted center">
                    검색 결과가 없어요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="a-card pad">
          {!selected ? (
            <p className="muted">회원을 선택하면 상세 정보가 표시됩니다.</p>
          ) : (
            <>
              <h2>{selected.nickname || selected.email}</h2>
              <dl className="a-dl">
                <dt>이메일</dt>
                <dd>{selected.email}</dd>
                <dt>가입일</dt>
                <dd>{selected.createdAt}</dd>
                <dt>저장 취향</dt>
                <dd>{selected.tastes.length ? selected.tastes.map((t) => TASTE_LABEL[t]).join(', ') : '-'}</dd>
              </dl>
              <MemberVisits key={selected.id} userId={selected.id} />
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function MemberVisits({userId}: {userId: string}) {
  const {data: visits, loading, error, reload} = useAsync(() => api.listMemberVisits(userId), [userId]);
  return <>
    <h3 className="mt-12">관람 기록</h3>
    {loading && <p role="status">관람 기록을 불러오는 중…</p>}
    {error && <p className="error-text" role="alert">{error} <button className="a-btn" onClick={reload}>관람 기록 다시 불러오기</button></p>}
    <ul className="a-visit-list">
      {visits?.map(v => <li key={v.id}>
        <span>{v.date.slice(0, 10)}</span>
        <span>작품 {v.viewedArtworkIds.length}점 · {v.durationMin}분</span>
      </li>)}
      {visits?.length === 0 && <li className="muted">기록 없음</li>}
    </ul>
  </>;
}

/** 관리자 — 관람객이 남긴 👍/👎와 이유 */
import { useState } from 'react';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { type ReactionLogItem } from '../../lib/reactionLog';
import { PageHead } from './AdminLayout';
import type { Reaction } from '../../types';

type Filter = 'all' | Reaction;

function formatAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export default function A07Reactions() {
  const { data } = useAsync(() => api.listAdminArtworks(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const {data: result, error, reload} = useAsync(() => api.listReactions(), []);
  const log = (result?.items ?? []).map(item => ({...item, at: item.date}));
  const likes = log.filter((item) => item.reaction === 'like').length;
  const dislikes = log.length - likes;
  const shown = filter === 'all' ? log : log.filter((item) => item.reaction === filter);
  const titleOf = (id: string) => data?.find((w) => w.id === id)?.title ?? id;

  return (
    <>
      <PageHead title="평가" desc="관람객이 작품에 남긴 좋아요·별로예요와 이유를 확인합니다." />
      {error && <p role="alert">{error}<button onClick={reload}>다시 불러오기</button></p>}
      <p>서버에 저장된 회원 관람 평가만 표시합니다. 최근 50건입니다.</p>
      <div className="react-filters" role="group" aria-label="평가 필터">
        <FilterButton label="전체" count={log.length} on={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterButton label="좋아요" count={likes} on={filter === 'like'} kind="like" onClick={() => setFilter('like')} />
        <FilterButton label="별로예요" count={dislikes} on={filter === 'dislike'} kind="dislike" onClick={() => setFilter('dislike')} />
      </div>
      <div className="a-card">
        {shown.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>
            {log.length === 0 ? '아직 받은 평가가 없어요.' : '이 조건에 해당하는 평가가 없어요.'}
          </p>
        ) : (
          <table className="a-table">
            <thead>
              <tr>
                <th>작품</th>
                <th>평가</th>
                <th>이유</th>
                <th>시간</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <Row key={item.visitId + item.artworkId} item={item} title={titleOf(item.artworkId)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function FilterButton({
  label,
  count,
  on,
  kind,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  kind?: Reaction;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`${kind ?? ''} ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function Row({ item, title }: { item: ReactionLogItem; title: string }) {
  const like = item.reaction === 'like';
  return (
    <tr>
      <td>{title}</td>
      <td>
        <span className={`react-badge ${item.reaction}`}>{like ? '좋아요' : '별로예요'}</span>
      </td>
      <td>{item.reason || '—'}</td>
      <td>{formatAt(item.at)}</td>
    </tr>
  );
}

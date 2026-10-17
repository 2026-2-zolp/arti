/**
 * A-04 작품 등록·수정
 * - /admin/artworks        : 작품 목록 (전시·검수 상태 필터)
 * - /admin/artworks/new    : 새 작품 등록
 * - /admin/artworks/:id    : 작품 수정
 * 작품 해설과 AI 응답 데이터의 신뢰성을 위해 출처·참고자료·검수 상태를 함께 관리한다.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { TASTE_LABEL } from '../../data/mock';
import { ArtImage } from '../../components/ArtImage';
import type { Artwork, ReviewStatus, TasteTag } from '../../types';
import { PageHead, REVIEW_LABEL } from './AdminLayout';

export function ArtworkList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const exFilter = params.get('exhibition') ?? '';
  const reviewFilter = params.get('review') ?? '';
  const { data } = useAsync(() => Promise.all([api.listExhibitions(), api.listArtworks()]), []);

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const rows = (data?.[1] ?? []).filter(
    (w) =>
      (!exFilter || w.exhibitionId === exFilter) &&
      (!reviewFilter || (reviewFilter === 'todo' ? w.reviewStatus !== 'approved' : w.reviewStatus === reviewFilter)),
  );
  const roomName = (w: Artwork) =>
    data?.[0].find((e) => e.id === w.exhibitionId)?.rooms.find((r) => r.id === w.roomId)?.name ?? '-';

  return (
    <>
      <PageHead
        title="작품 관리"
        desc="작품 정보와 설명, 출처·참고자료, 검수 상태를 함께 관리합니다."
        actions={
          <button className="a-btn primary" onClick={() => navigate(`/admin/artworks/new${exFilter ? `?exhibition=${exFilter}` : ''}`)}>
            + 작품 등록
          </button>
        }
      />
      <div className="a-filters">
        <select value={exFilter} onChange={(e) => setFilter('exhibition', e.target.value)} aria-label="전시 필터">
          <option value="">전체 전시</option>
          {data?.[0].map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
        <select value={reviewFilter} onChange={(e) => setFilter('review', e.target.value)} aria-label="검수 상태 필터">
          <option value="">전체 검수 상태</option>
          <option value="todo">검수 필요 (대기+출처 확인)</option>
          {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((s) => (
            <option key={s} value={s}>
              {REVIEW_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="muted small">{rows.length}건</span>
      </div>
      <div className="a-card">
        <table className="a-table">
          <thead>
            <tr>
              <th style={{ width: 64 }} />
              <th>작품명</th>
              <th>작가</th>
              <th>연도</th>
              <th>전시실</th>
              <th>위치</th>
              <th>검수 상태</th>
              <th>수정일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="clickable" onClick={() => navigate(`/admin/artworks/${w.id}`)}>
                <td>
                  <ArtImage className="a-thumb" seed={w.id} palette={w.palette} imageUrl={w.imageUrl} alt="" ratio={1} />
                </td>
                <td>
                  <strong>{w.title}</strong>
                </td>
                <td>{w.artist}</td>
                <td>{w.year}</td>
                <td>{roomName(w)}</td>
                <td>{w.position ? '등록' : <span className="text-warn">미등록</span>}</td>
                <td>
                  <span className={`badge ${w.reviewStatus}`}>{REVIEW_LABEL[w.reviewStatus]}</span>
                </td>
                <td>{w.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const emptyArtwork = (exhibitionId: string): Artwork => ({
  id: '',
  exhibitionId,
  title: '',
  artist: '',
  year: '',
  roomId: '',
  position: null,
  palette: ['#EDE6DD', '#8C6A4A', '#2E3A4D', '#C99A55', '#F7F1E8'],
  tags: [],
  description: '',
  guidedLooking: [],
  source: '',
  referenceUrl: '',
  reviewStatus: 'pending',
  updatedAt: '',
});

export function ArtworkEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const { data } = useAsync(
    () => Promise.all([api.listExhibitions(), isNew ? Promise.resolve(null) : api.getArtwork(id!)]),
    [id],
  );
  const [w, setW] = useState<Artwork | null>(null);
  const [guided, setGuided] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    const initial = data[1] ?? emptyArtwork(params.get('exhibition') ?? data[0][0]?.id ?? '');
    setW(initial);
    setGuided(initial.guidedLooking.join('\n'));
  }, [data, params]);

  if (!data || !w) return <PageHead title="작품 등록·수정" desc="불러오는 중…" />;

  const exhibitions = data[0];
  const rooms = exhibitions.find((e) => e.id === w.exhibitionId)?.rooms ?? [];
  const set = <K extends keyof Artwork>(k: K, v: Artwork[K]) => setW((cur) => (cur ? { ...cur, [k]: v } : cur));
  const toggleTag = (t: TasteTag) => set('tags', w.tags.includes(t) ? w.tags.filter((x) => x !== t) : [...w.tags, t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!w.title.trim() || !w.artist.trim()) return setMsg({ type: 'err', text: '작품명과 작가는 필수입니다.' });
    if (w.reviewStatus === 'approved' && (!w.source.trim() || !w.description.trim()))
      return setMsg({ type: 'err', text: '검수 완료로 저장하려면 작품 해설과 출처가 있어야 해요.' });
    const saved = await api.saveArtwork({
      ...w,
      guidedLooking: guided.split('\n').map((s) => s.trim()).filter(Boolean),
    });
    setMsg({ type: 'ok', text: '저장했습니다.' });
    if (isNew) navigate(`/admin/artworks/${saved.id}`, { replace: true });
  };

  return (
    <form onSubmit={submit}>
      <PageHead
        title="작품 등록·수정"
        desc="작품 정보와 설명, 출처·참고자료, 검수 상태를 함께 관리합니다."
        actions={
          <Link className="a-btn" to="/admin/artworks">
            목록으로
          </Link>
        }
      />
      <div className="a-two-col">
        <section className="a-card pad">
          <h2>기본 정보</h2>
          <label className="a-field">
            <span>작품명</span>
            <input value={w.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          <label className="a-field">
            <span>작가</span>
            <input value={w.artist} onChange={(e) => set('artist', e.target.value)} />
          </label>
          <label className="a-field">
            <span>제작연도</span>
            <input value={w.year} onChange={(e) => set('year', e.target.value)} placeholder="예: 1889" />
          </label>
          <div className="a-row">
            <label className="a-field">
              <span>전시</span>
              <select value={w.exhibitionId} onChange={(e) => set('exhibitionId', e.target.value)}>
                {exhibitions.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="a-field">
              <span>전시실 / 위치</span>
              <select value={w.roomId} onChange={(e) => set('roomId', e.target.value)}>
                <option value="">선택</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="a-field">
            <span>작품 이미지 URL</span>
            <input
              value={w.imageUrl ?? ''}
              onChange={(e) => set('imageUrl', e.target.value || undefined)}
              placeholder="https:// (비우면 자리표시 이미지 사용)"
            />
          </label>
          <div className="a-field">
            <span>취향 태그 (추천에 사용)</span>
            <div className="chips wrap">
              {(Object.keys(TASTE_LABEL) as TasteTag[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`chip ${w.tags.includes(t) ? 'accent' : 'outline'}`}
                  aria-pressed={w.tags.includes(t)}
                  onClick={() => toggleTag(t)}
                >
                  {TASTE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="a-field">
            <span>평면도 위치</span>
            <div className="a-inline">
              <span className={w.position ? '' : 'text-warn'}>
                {w.position ? `x ${w.position.x}, y ${w.position.y}` : '미등록'}
              </span>
              {w.id && (
                <Link className="a-btn sm" to={`/admin/map?exhibition=${w.exhibitionId}&artwork=${w.id}`}>
                  위치·지도 관리
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="a-card pad">
          <h2>설명 및 검수</h2>
          <label className="a-field">
            <span>작품 해설</span>
            <textarea rows={6} value={w.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label className="a-field">
            <span>Guided Looking 질문 (한 줄에 하나)</span>
            <textarea rows={4} value={guided} onChange={(e) => setGuided(e.target.value)} />
          </label>
          <label className="a-field">
            <span>출처</span>
            <input value={w.source} onChange={(e) => set('source', e.target.value)} />
          </label>
          <label className="a-field">
            <span>참고자료 URL</span>
            <input type="url" value={w.referenceUrl} onChange={(e) => set('referenceUrl', e.target.value)} />
          </label>
          <div className="a-row end">
            <label className="a-field">
              <span>검수 상태</span>
              <select value={w.reviewStatus} onChange={(e) => set('reviewStatus', e.target.value as ReviewStatus)}>
                {(Object.keys(REVIEW_LABEL) as ReviewStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <button className="a-btn primary save">저장</button>
          </div>
          {msg && <p className={msg.type === 'ok' ? 'ok-text' : 'error-text'}>{msg.text}</p>}
          <p className="muted small">검수 완료 + 위치 등록된 작품만 사용자 추천에 노출됩니다.</p>
        </section>
      </div>
    </form>
  );
}

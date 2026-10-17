/**
 * A-05 위치·지도 관리
 * 작품을 선택 → 평면도를 클릭해 좌표 지정 → 위치 저장.
 * 여기서 저장한 좌표가 사용자 U-09 추천 경로와 관람 순서 계산에 쓰인다.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { FloorMap, type MapMarker } from '../../components/FloorMap';
import type { Artwork, MapPoint } from '../../types';
import { PageHead } from './AdminLayout';

export default function A05Map() {
  const [params, setParams] = useSearchParams();
  const { data: exhibitions } = useAsync(() => api.listExhibitions(), []);
  const exId = params.get('exhibition') ?? exhibitions?.[0]?.id ?? '';
  const { data: artworks, setData: setArtworks } = useAsync(
    () => (exId ? api.listArtworks(exId) : Promise.resolve([] as Artwork[])),
    [exId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(params.get('artwork'));
  const [draft, setDraft] = useState<MapPoint | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
    setMsg(null);
  }, [selectedId]);

  const ex = exhibitions?.find((e) => e.id === exId);
  if (!ex || !artworks) return <PageHead title="위치·지도 관리" desc="불러오는 중…" />;

  const selected = artworks.find((w) => w.id === selectedId) ?? null;
  const roomName = (w: Artwork) => ex.rooms.find((r) => r.id === w.roomId)?.name ?? '전시실 미지정';

  const markers: MapMarker[] = artworks
    .map((w, i) => ({ w, n: i + 1 }))
    .filter(({ w }) => (w.id === selectedId && draft) || w.position)
    .map(({ w, n }) => ({
      id: w.id,
      label: String(n),
      title: w.title,
      point: w.id === selectedId && draft ? draft : w.position!,
      state: w.id === selectedId ? 'selected' : 'plain',
    }));

  const savePosition = async () => {
    if (!selected || !draft) return;
    // 클릭한 좌표가 어느 전시실 안에 있는지 계산해 전시실도 함께 갱신
    const room = ex.rooms.find(
      (r) => draft.x >= r.rect.x && draft.x <= r.rect.x + r.rect.w && draft.y >= r.rect.y && draft.y <= r.rect.y + r.rect.h,
    );
    const saved = await api.saveArtwork({ ...selected, position: draft, roomId: room?.id ?? selected.roomId });
    setArtworks(artworks.map((w) => (w.id === saved.id ? saved : w)));
    setDraft(null);
    setMsg(`'${saved.title}' 위치를 저장했어요${room ? ` (${room.name})` : ''}.`);
  };

  const clearPosition = async () => {
    if (!selected) return;
    const saved = await api.saveArtwork({ ...selected, position: null });
    setArtworks(artworks.map((w) => (w.id === saved.id ? saved : w)));
    setMsg(`'${saved.title}' 위치를 해제했어요.`);
  };

  return (
    <>
      <PageHead
        title="위치·지도 관리"
        desc="2D 평면도 위에 작품 위치와 관람 순서 계산에 사용할 위치 정보를 등록합니다."
        actions={
          <select
            value={exId}
            onChange={(e) => {
              setSelectedId(null);
              setParams({ exhibition: e.target.value });
            }}
            aria-label="전시 선택"
          >
            {exhibitions!.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        }
      />
      <div className="a-map-layout">
        <section className="a-card pad">
          {ex.rooms.length === 0 ? (
            <p className="muted">이 전시에는 아직 평면도(전시실)가 등록되지 않았어요.</p>
          ) : (
            <>
              <FloorMap
                exhibition={ex}
                markers={markers}
                aspect={1.55}
                onMapClick={selected ? setDraft : undefined}
                onMarkerClick={setSelectedId}
              />
              <div className="a-map-bar">
                {selected ? (
                  <>
                    <span>
                      <strong>{selected.title}</strong> —{' '}
                      {draft ? `새 위치 x ${draft.x}, y ${draft.y}` : '평면도를 클릭해 위치를 지정하세요'}
                    </span>
                    <span className="a-inline">
                      {selected.position && !draft && (
                        <button className="a-btn sm" onClick={clearPosition}>
                          위치 해제
                        </button>
                      )}
                      <button className="a-btn primary sm" disabled={!draft} onClick={savePosition}>
                        위치 저장
                      </button>
                    </span>
                  </>
                ) : (
                  <span className="muted">오른쪽 목록에서 작품을 선택한 뒤 지도 위치를 지정합니다.</span>
                )}
              </div>
              {msg && <p className="ok-text">{msg}</p>}
            </>
          )}
        </section>

        <aside className="a-card pad">
          <h2>작품 위치</h2>
          <ul className="a-pos-list">
            {artworks.map((w, i) => (
              <li key={w.id}>
                <button className={`a-pos-item ${w.id === selectedId ? 'on' : ''}`} onClick={() => setSelectedId(w.id)}>
                  <span className="a-pos-num">{i + 1}</span>
                  <span className="a-pos-text">
                    {w.title} · {roomName(w)}
                  </span>
                  {!w.position && <span className="badge pending">미등록</span>}
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <Link className="a-btn block mt-12" to={`/admin/artworks/${selected.id}`}>
              작품 관리로 이동
            </Link>
          )}
        </aside>
      </div>
    </>
  );
}

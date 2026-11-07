/**
 * A-05 위치·지도 관리
 * - 미술관 평면도(안내도) 캡처 이미지를 올리면 그 이미지가 지도가 된다 (없으면 전시실 사각형 기본 평면도)
 * - 작품 마커·입구를 끌어서 옮기면 바로 저장. 위치가 없는 작품은 선택 → 지도 클릭 → 위치 저장
 * - 전시실 이름 목록 편집 (작품마다 어느 전시실인지 고른다)
 * 여기서 저장한 좌표가 사용자 U-09 추천 경로와 관람 순서 계산에 쓰인다.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../lib/useAsync';
import { FloorMap, type MapMarker } from '../../components/FloorMap';
import type { Artwork, Exhibition, MapPoint, Room } from '../../types';
import { PageHead } from './AdminLayout';

/** 기본 평면도(사각형)에서 좌표가 들어 있는 전시실 */
const roomAt = (ex: Exhibition, p: MapPoint) =>
  ex.floorPlan
    ? undefined
    : ex.rooms.find((r) => r.rect && p.x >= r.rect.x && p.x <= r.rect.x + r.rect.w && p.y >= r.rect.y && p.y <= r.rect.y + r.rect.h);

export default function A05Map() {
  const [params, setParams] = useSearchParams();
  const { data: exhibitions, setData: setExhibitions } = useAsync(() => api.listExhibitions(), []);
  const exId = params.get('exhibition') ?? exhibitions?.[0]?.id ?? '';
  const { data: artworks, setData: setArtworks } = useAsync(
    () => (exId ? api.listArtworks(exId) : Promise.resolve([] as Artwork[])),
    [exId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(params.get('artwork'));
  const [draft, setDraft] = useState<MapPoint | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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

  const fail = (e: unknown) => setMsg({ type: 'err', text: e instanceof Error ? e.message : '저장하지 못했어요.' });
  const applyArtwork = (saved: Artwork) => setArtworks(artworks.map((w) => (w.id === saved.id ? saved : w)));
  const applyExhibition = (saved: Exhibition) => setExhibitions(exhibitions!.map((e) => (e.id === saved.id ? saved : e)));

  /** 위치 저장. 기본 평면도에서는 놓인 전시실도 함께 갱신한다 */
  const savePosition = async (w: Artwork, p: MapPoint) => {
    const room = roomAt(ex, p);
    try {
      applyArtwork(await api.saveArtwork({ ...w, position: p, roomId: room?.id ?? w.roomId }));
      setDraft(null);
      setMsg({ type: 'ok', text: `'${w.title}' 위치를 저장했어요${room ? ` (${room.name})` : ''}.` });
    } catch (e) {
      fail(e);
    }
  };

  const clearPosition = async () => {
    if (!selected) return;
    try {
      applyArtwork(await api.saveArtwork({ ...selected, position: null }));
      setMsg({ type: 'ok', text: `'${selected.title}' 위치를 해제했어요.` });
    } catch (e) {
      fail(e);
    }
  };

  const changeRoom = async (roomId: string) => {
    if (!selected) return;
    try {
      applyArtwork(await api.saveArtwork({ ...selected, roomId }));
    } catch (e) {
      fail(e);
    }
  };

  const saveExhibition = async (next: Exhibition, ok: string) => {
    try {
      applyExhibition(await api.saveExhibition(next));
      setMsg({ type: 'ok', text: ok });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <PageHead
        title="위치·지도 관리"
        desc="미술관 평면도 위에 작품 위치와 입구를 지정합니다. 이 위치로 사용자의 추천 관람 순서와 경로를 계산해요."
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
        <div className="stack gap-24">
          <FloorPlanField
            ex={ex}
            positioned={artworks.filter((w) => w.position).length}
            onSaved={(saved, text) => {
              applyExhibition(saved);
              setMsg({ type: 'ok', text });
            }}
            onError={fail}
          />

          <section className="a-card pad">
            <FloorMap
              exhibition={ex}
              markers={markers}
              aspect={1.55}
              onMapClick={selected ? setDraft : undefined}
              onMarkerClick={setSelectedId}
              onMarkerMove={(id, p) => {
                const w = artworks.find((a) => a.id === id);
                setSelectedId(id);
                if (w) savePosition(w, p);
              }}
              onEntranceMove={(p) => saveExhibition({ ...ex, entrance: p }, '입구 위치를 저장했어요. 추천 경로가 이 위치에서 시작해요.')}
            />
            <div className="a-map-bar">
              {selected ? (
                <>
                  <span>
                    <strong>{selected.title}</strong> —{' '}
                    {draft
                      ? `새 위치 x ${draft.x}, y ${draft.y}`
                      : selected.position
                        ? '마커를 끌어서 옮기거나 지도를 클릭해 새 위치를 지정하세요'
                        : '지도를 클릭해 위치를 지정하세요'}
                  </span>
                  <span className="a-inline">
                    <select value={selected.roomId} onChange={(e) => changeRoom(e.target.value)} aria-label="전시실">
                      <option value="">전시실 미지정</option>
                      {ex.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    {selected.position && !draft && (
                      <button className="a-btn sm" onClick={clearPosition}>
                        위치 해제
                      </button>
                    )}
                    {draft && (
                      <>
                        <button className="a-btn sm" onClick={() => setDraft(null)}>
                          취소
                        </button>
                        <button className="a-btn primary sm" onClick={() => savePosition(selected, draft)}>
                          위치 저장
                        </button>
                      </>
                    )}
                  </span>
                </>
              ) : (
                <span className="muted">
                  번호 마커와 「입구」를 끌어서 옮기면 바로 저장돼요. 위치가 없는 작품은 오른쪽 목록에서 고른 뒤 지도를 클릭하세요.
                </span>
              )}
            </div>
            {msg && <p className={msg.type === 'ok' ? 'ok-text' : 'error-text'}>{msg.text}</p>}
          </section>
        </div>

        <aside className="stack gap-24">
          <div className="a-card pad">
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
          </div>

          <RoomsEditor
            key={ex.id}
            ex={ex}
            artworks={artworks}
            onSave={(rooms) => saveExhibition({ ...ex, rooms }, '전시실 목록을 저장했어요.')}
          />
        </aside>
      </div>
    </>
  );
}

/** 이미지 파일의 원본 픽셀 크기 (지도 비율 계산용) */
function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 파일을 열 수 없어요.'));
    };
    img.src = url;
  });
}

/** 미술관 평면도 이미지 올리기·바꾸기·삭제 */
function FloorPlanField({
  ex,
  positioned,
  onSaved,
  onError,
}: {
  ex: Exhibition;
  positioned: number;
  onSaved: (ex: Exhibition, text: string) => void;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const plan = ex.floorPlan;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return onError(new Error('PNG, JPG, WEBP 이미지만 올릴 수 있어요.'));
    if (file.size > 10 * 1024 * 1024) return onError(new Error('이미지는 10MB 이하로 올려 주세요.'));
    setBusy(true);
    try {
      const { width, height } = await readImageSize(file);
      // 좌표는 이미지 기준 퍼센트라 가로세로 비율이 달라지면 마커가 실제 위치와 어긋난다
      const oldRatio = plan ? plan.width / plan.height : null;
      const ratioChanged = oldRatio !== null && Math.abs(width / height - oldRatio) / oldRatio > 0.02;
      if (
        positioned > 0 &&
        (ratioChanged || !plan) &&
        !confirm(`이미 위치를 지정한 작품이 ${positioned}점 있어요. 새 평면도를 올리면 위치가 어긋날 수 있으니 올린 뒤 마커 위치를 확인해 주세요. 계속할까요?`)
      )
        return;
      const saved = await api.uploadFloorPlan(ex.id, file, width, height);
      onSaved(saved, positioned > 0 ? '평면도를 올렸어요. 작품 마커와 입구가 실제 위치에 있는지 확인해 주세요.' : '평면도를 올렸어요. 이제 작품 위치를 지정해 주세요.');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('평면도 이미지를 삭제할까요? 지도는 전시실 사각형 기본 평면도로 돌아가요.')) return;
    try {
      onSaved(await api.deleteFloorPlan(ex.id), '평면도 이미지를 삭제했어요.');
    } catch (e) {
      onError(e);
    }
  };

  return (
    <section className="a-card pad">
      <h2>미술관 평면도</h2>
      <div
        className={`img-drop ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files[0]);
        }}
      >
        <div className="img-drop-actions">
          <strong>{plan ? '평면도 이미지를 사용 중이에요' : '평면도를 넣어 주세요'}</strong>
          <span className="muted small">
            {plan
              ? `${plan.width}×${plan.height}px · 비율이 다른 이미지로 바꾸면 작품 위치를 다시 확인해야 해요.`
              : '미술관 안내도를 캡처해 올리면 그 위에서 작품 위치를 옮길 수 있어요. 끌어다 놓아도 돼요 (PNG·JPG·WEBP, 10MB 이하)'}
          </span>
          <span className="a-inline">
            <label className="a-btn sm">
              {busy ? '올리는 중…' : plan ? '다른 평면도로 바꾸기' : '평면도 이미지 올리기'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                disabled={busy}
                onChange={(e) => {
                  upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {plan && (
              <button type="button" className="a-btn sm" onClick={remove}>
                평면도 삭제
              </button>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

/** 전시실 이름 목록 편집 (추가·이름 변경·삭제 후 한 번에 저장) */
function RoomsEditor({ ex, artworks, onSave }: { ex: Exhibition; artworks: Artwork[]; onSave: (rooms: Room[]) => void }) {
  const [rooms, setRooms] = useState<Room[]>(ex.rooms);
  const [newName, setNewName] = useState('');

  useEffect(() => setRooms(ex.rooms), [ex.rooms]);

  const dirty = JSON.stringify(rooms) !== JSON.stringify(ex.rooms);
  const count = (id: string) => artworks.filter((w) => w.roomId === id).length;

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    // 기존 id와 겹치지 않는 새 id (r1, r2 … 다음 번호)
    const next = Math.max(0, ...rooms.map((r) => Number(r.id.replace(/\D/g, '')) || 0)) + 1;
    setRooms([...rooms, { id: `r${next}`, name }]);
    setNewName('');
  };

  const remove = (r: Room) => {
    const n = count(r.id);
    if (n > 0 && !confirm(`'${r.name}'에 작품 ${n}점이 있어요. 삭제하면 이 작품들은 「전시실 미지정」이 돼요. 삭제할까요?`)) return;
    setRooms(rooms.filter((x) => x.id !== r.id));
  };

  return (
    <div className="a-card pad">
      <h2>전시실</h2>
      <ul className="a-room-list">
        {rooms.map((r) => (
          <li key={r.id}>
            <input
              value={r.name}
              maxLength={50}
              aria-label="전시실 이름"
              onChange={(e) => setRooms(rooms.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))}
            />
            <span className="muted small">{count(r.id)}점</span>
            <button type="button" className="a-btn sm" onClick={() => remove(r)}>
              삭제
            </button>
          </li>
        ))}
      </ul>
      <div className="a-inline mt-12">
        <input
          className="a-room-new"
          value={newName}
          maxLength={50}
          placeholder="새 전시실 이름 (예: 5전시실)"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" className="a-btn sm" onClick={add}>
          추가
        </button>
      </div>
      {!ex.floorPlan && <p className="muted small mt-12">평면도 이미지가 없으면 새로 추가한 전시실은 지도에 그려지지 않아요.</p>}
      <button
        type="button"
        className="a-btn primary block mt-12"
        disabled={!dirty || rooms.some((r) => !r.name.trim())}
        onClick={() => onSave(rooms.map((r) => ({ ...r, name: r.name.trim() })))}
      >
        전시실 목록 저장
      </button>
    </div>
  );
}

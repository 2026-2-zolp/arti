import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { FloorMap } from '../../components/FloorMap';
import type { Exhibition, MapPoint, NavigationLayoutInput } from '../../types';

const categories = {
  walkable: '관람 가능 공간', walls: '벽', pillars: '기둥', doors: '문',
  corridors: '통로', waypoints: '연결점',
} as const;
type Category = keyof typeof categories;
const categoryKeys = Object.keys(categories) as Category[];
const emptyLayout: NavigationLayoutInput = { walkable: [], walls: [], pillars: [], doors: [], corridors: [], waypoints: [] };

export default function NavigationEditor({ exhibition, onSaved, onConflict }: {
  exhibition: Exhibition;
  onSaved: (value: Exhibition) => void;
  onConflict: () => void;
}) {
  const revision = exhibition.floorPlanRevision!;
  const [layout, setLayout] = useState<NavigationLayoutInput>(() => ({
    ...emptyLayout,
    ...Object.fromEntries(categoryKeys.map(key => [key, exhibition.navigationLayout?.[key] ?? []])),
  }));
  const [category, setCategory] = useState<Category>('walkable');
  const [corner, setCorner] = useState<MapPoint | null>(null);
  const [reference, setReference] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; conflict?: boolean } | null>(null);
  const draftExhibition = {
    ...exhibition,
    navigationLayout: { ...layout, floorPlanRevision: revision,
      aspect: exhibition.floorPlan ? exhibition.floorPlan.width / exhibition.floorPlan.height : 1 },
  };

  const addPoint = (point: MapPoint) => {
    if (busy || layout[category].length >= 32) return;
    if (category === 'waypoints') {
      setLayout({ ...layout, waypoints: [...layout.waypoints, point] });
      return;
    }
    if (!corner) { setCorner(point); return; }
    const rect = { x: Math.min(corner.x, point.x), y: Math.min(corner.y, point.y),
      w: Math.abs(corner.x - point.x), h: Math.abs(corner.y - point.y) };
    if (rect.w < 0.1 || rect.h < 0.1) return;
    setLayout({ ...layout, [category]: [...layout[category], rect] });
    setCorner(null);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const unchanged = categoryKeys.every(key => layout[key].length === 0);
      const saved = await api.saveNavigationLayout(exhibition, unchanged ? null : layout);
      onSaved(saved);
      setMessage({ text: '현재 도면 버전에 이동 구조를 저장했어요.' });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : '이동 구조를 저장하지 못했어요.',
        error: true, conflict: error instanceof ApiError && error.status === 409 });
    } finally { setBusy(false); }
  };

  return (
    <section className="a-card pad stack gap-10" aria-label="이동 구조 편집">
      <h3>이동 구조 편집</h3>
      <p className="muted small">도면 버전 {revision} · 사각형은 마주 보는 모서리 두 곳, 연결점은 한 곳을 누르세요. 벽은 문이 있는 곳에서 나눠 그리세요.</p>
      <div className="a-inline">
        <select aria-label="이동 구조 종류" value={category} onChange={event => {
          setCategory(event.target.value as Category); setCorner(null);
        }}>
          {categoryKeys.map(key => <option key={key} value={key}>{categories[key]} ({layout[key].length})</option>)}
        </select>
        <button type="button" className="a-btn" disabled={busy || (!corner && !layout[category].length)} onClick={() => {
          if (corner) setCorner(null);
          else setLayout({ ...layout, [category]: layout[category].slice(0, -1) });
        }}>마지막 입력 취소</button>
        {exhibition.floorPlan && <label><input type="checkbox" checked={reference}
          onChange={event => setReference(event.target.checked)} /> 원본 도면 겹쳐 보기</label>}
      </div>
      <p className="small" role="status">{corner ? '반대쪽 모서리를 선택해 주세요.' : `${categories[category]} 위치를 선택해 주세요.`}</p>
      <FloorMap exhibition={draftExhibition} markers={corner ? [{ id: 'first-corner', label: '1', point: corner, state: 'selected' }] : []}
        onMapClick={addPoint} forAdmin showReference={reference} showEntrance={false} />
      <button className="a-btn primary" type="button" onClick={save} disabled={busy || corner !== null || !!message?.conflict}>이동 구조 저장</button>
      {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {message?.conflict && <button type="button" className="a-btn" onClick={onConflict}>최신 도면 다시 불러오기</button>}
    </section>
  );
}

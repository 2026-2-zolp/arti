import { useId, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { FloorMap, type MapMarker } from '../../components/FloorMap';
import { exhibitionIndoorLayout } from '../../lib/indoorMapFixture';
import { indoorLeg } from '../../lib/indoorRoute';
import type { Artwork, Exhibition, MapPoint, NavigationLayoutInput } from '../../types';

const categories = {
  walkable: '관람 가능 공간', walls: '벽', pillars: '기둥', doors: '문',
  corridors: '통로', waypoints: '연결점',
} as const;
type Category = keyof typeof categories;
const categoryKeys = Object.keys(categories) as Category[];
const emptyLayout: NavigationLayoutInput = { walkable: [], walls: [], pillars: [], doors: [], corridors: [], waypoints: [] };

export default function NavigationEditor({ exhibition, artworks, onSaved, onConflict }: {
  exhibition: Exhibition;
  artworks: readonly Artwork[];
  onSaved: (value: Exhibition) => void;
  onConflict: () => void;
}) {
  const revision = exhibition.floorPlanRevision!;
  const previewId = useId();
  const [layout, setLayout] = useState<NavigationLayoutInput>(() => ({
    ...emptyLayout,
    ...Object.fromEntries(categoryKeys.map(key => [key, exhibition.navigationLayout?.[key] ?? []])),
  }));
  const [category, setCategory] = useState<Category>('walkable');
  const [corner, setCorner] = useState<MapPoint | null>(null);
  const [reference, setReference] = useState(true);
  const [departureId, setDepartureId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; conflict?: boolean } | null>(null);
  const draftExhibition: Exhibition = {
    ...exhibition,
    navigationLayout: { ...layout, floorPlanRevision: revision,
      aspect: exhibition.floorPlan ? exhibition.floorPlan.width / exhibition.floorPlan.height : 1 },
  };
  const positioned = artworks.flatMap((work, index) => work.position ? [{
    id: work.id, title: work.title, point: work.position, label: String(index + 1),
  }] : []);
  const departure = positioned.find(work => work.id === departureId);
  const destination = positioned.find(work => work.id === destinationId);
  const indoor = layout.walkable.length > 0 ? exhibitionIndoorLayout(draftExhibition) : undefined;
  const preview = indoor && destination
    ? indoorLeg(indoor, departure?.point ?? exhibition.entrance, destination.point)
    : null;
  const markers: MapMarker[] = [];
  if (destination) {
    if (departure) markers.push({ ...departure, state: 'plain' });
    markers.push({ ...destination, state: 'selected' });
  }
  if (corner) markers.push({ id: 'first-corner', label: '1', point: corner, state: 'selected' });

  let previewStatus = '위치가 등록된 작품을 도착점으로 선택해 주세요.';
  if (positioned.length === 0) previewStatus = '작품 위치를 저장하면 이동 경로를 확인할 수 있어요.';
  else if (destination) {
    if (!indoor) previewStatus = '관람 가능 공간을 먼저 등록해 주세요.';
    else previewStatus = preview ? '현재 편집 내용으로 연결된 경로예요.' : '이어지는 경로가 없어요. 문·통로·연결점을 확인해 주세요.';
  }

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
      <div role="group" aria-label="경로 미리보기" className="a-navigation-preview stack gap-10">
        <h4>경로 미리보기</h4>
        <p className="muted small">관람자 지도에는 저장한 구조가 표시돼요.</p>
        <div className="a-inline">
          <div>
            <label htmlFor={`${previewId}-departure`}>출발</label>
            <select id={`${previewId}-departure`} value={departure?.id ?? ''} onChange={event => setDepartureId(event.target.value)}>
              <option value="">입구</option>
              {positioned.filter(work => work.id !== destination?.id).map(work => (
                <option key={work.id} value={work.id}>{work.label}. {work.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${previewId}-destination`}>도착</label>
            <select id={`${previewId}-destination`} value={destination?.id ?? ''} onChange={event => setDestinationId(event.target.value)}
              disabled={positioned.length === 0}>
              <option value="">작품 선택</option>
              {positioned.filter(work => work.id !== departure?.id).map(work => (
                <option key={work.id} value={work.id}>{work.label}. {work.title}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="small" role="status">{previewStatus}</p>
      </div>
      <FloorMap exhibition={draftExhibition} markers={markers} activeLeg={preview}
        onMapClick={addPoint} forAdmin showReference={reference} showEntrance={!!destination && !departure} />
      <button className="a-btn primary" type="button" onClick={save} disabled={busy || corner !== null || !!message?.conflict}>이동 구조 저장</button>
      {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {message?.conflict && <button type="button" className="a-btn" onClick={onConflict}>최신 도면 다시 불러오기</button>}
    </section>
  );
}

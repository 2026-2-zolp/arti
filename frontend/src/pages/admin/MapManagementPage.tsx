import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@/api/types';
import { Button, EmptyState, QueryState, Select, Skeleton, useToast } from '@/components/common';
import { AdminPageHeader, AdminPanel } from '@/components/layout/AdminLayout';
import { FloorMapView, type MapMarker } from '@/components/map/FloorMapView';
import {
  useAdminArtworks,
  useAdminExhibitions,
  useAdminMap,
  useSavePosition,
} from '@/hooks/queries/useAdminQueries';
import { paths } from '@/routes/paths';
import type { Artwork, ExhibitionMapData } from '@/types/domain';
import styles from './MapManagementPage.module.css';

/**
 * A-05 위치·지도 관리 (/admin/map?exhibitionId=&artworkId=)
 * 평면도 클릭 위치를 0~1 정규화 좌표로 저장한다. U-09 사용자 지도와 같은 데이터를 사용.
 */
export function MapManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const exhibitions = useAdminExhibitions();
  const exhibitionId =
    searchParams.get('exhibitionId') ?? exhibitions.data?.[0]?.exhibitionId ?? '';
  const selectedArtworkId = searchParams.get('artworkId');

  const mapQuery = useAdminMap(exhibitionId || undefined);
  const artworksQuery = useAdminArtworks(exhibitionId || undefined);

  const updateParams = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    if (!params.get('exhibitionId') && exhibitionId) params.set('exhibitionId', exhibitionId);
    Object.entries(next).forEach(([k, v]) => (v ? params.set(k, v) : params.delete(k)));
    setSearchParams(params, { replace: true });
  };

  return (
    <>
      <AdminPageHeader
        title="위치·지도 관리"
        description="2D 평면도 위에 작품 위치와 관람 순서 계산에 사용할 위치 정보를 등록합니다."
        actions={
          <div className={styles.exhibitionSelect}>
            <Select
              tone="admin"
              aria-label="전시 선택"
              value={exhibitionId}
              options={(exhibitions.data ?? []).map((e) => ({
                value: e.exhibitionId,
                label: e.title,
              }))}
              onChange={(e) => updateParams({ exhibitionId: e.target.value, artworkId: null })}
            />
          </div>
        }
      />

      {!exhibitionId ? (
        <AdminPanel>
          <QueryState query={exhibitions} empty={<EmptyState title="등록된 전시가 없어요" />}>
            {() => <EmptyState title="전시를 선택해 주세요" />}
          </QueryState>
        </AdminPanel>
      ) : (
        <QueryState
          query={mapQuery}
          loading={<Skeleton height={680} radius={20} />}
          isEmpty={(data) => data.maps.length === 0}
          empty={
            <AdminPanel>
              <EmptyState
                icon="map"
                title="이 전시에는 등록된 평면도가 없어요"
                description="평면도 등록 기능은 서버 연동 단계에서 추가됩니다."
              />
            </AdminPanel>
          }
        >
          {(mapData) => (
            <QueryState query={artworksQuery} loading={<Skeleton height={680} radius={20} />}>
              {(artworks) => (
                <MapEditor
                  key={exhibitionId}
                  mapData={mapData}
                  artworks={artworks}
                  selectedArtworkId={selectedArtworkId}
                  onSelect={(id) => updateParams({ artworkId: id })}
                />
              )}
            </QueryState>
          )}
        </QueryState>
      )}
    </>
  );
}

function MapEditor({
  mapData,
  artworks,
  selectedArtworkId,
  onSelect,
}: {
  mapData: ExhibitionMapData;
  artworks: Artwork[];
  selectedArtworkId: string | null;
  onSelect: (artworkId: string | null) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const savePosition = useSavePosition();
  const [mapId, setMapId] = useState(mapData.maps[0].mapId);
  const [draft, setDraft] = useState<{ xRatio: number; yRatio: number } | null>(null);

  const map = mapData.maps.find((m) => m.mapId === mapId) ?? mapData.maps[0];
  const positions = useMemo(
    () => new Map(mapData.positions.map((p) => [p.artworkId, p])),
    [mapData.positions],
  );
  const selected = artworks.find((a) => a.artworkId === selectedArtworkId) ?? null;

  const markers: MapMarker[] = artworks
    .map((a, i) => ({ artwork: a, no: i + 1, pos: positions.get(a.artworkId) }))
    .filter(
      ({ pos, artwork }) =>
        pos?.mapId === map.mapId && !(draft && artwork.artworkId === selectedArtworkId),
    )
    .map(({ artwork, no, pos }) => ({
      artworkId: artwork.artworkId,
      label: String(no),
      xRatio: pos!.xRatio,
      yRatio: pos!.yRatio,
      title: artwork.title,
      state: artwork.artworkId === selectedArtworkId ? 'selected' : 'default',
    }));

  if (draft && selected) {
    markers.push({
      artworkId: `${selected.artworkId}-draft`,
      label: String(artworks.indexOf(selected) + 1),
      xRatio: draft.xRatio,
      yRatio: draft.yRatio,
      title: `${selected.title} (저장 전)`,
      state: 'draft',
    });
  }

  const handleSave = () => {
    if (!selected || !draft) return;
    savePosition.mutate(
      { mapId: map.mapId, artworkId: selected.artworkId, ...draft },
      {
        onSuccess: () => {
          toast.success(`‘${selected.title}’ 위치를 저장했어요`);
          setDraft(null);
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  };

  return (
    <div className={styles.layout}>
      <section className={styles.mapPanel}>
        {mapData.maps.length > 1 && (
          <div className={styles.floors}>
            {mapData.maps.map((m) => (
              <Button
                key={m.mapId}
                size="sm"
                variant={m.mapId === map.mapId ? 'primary' : 'secondary'}
                onClick={() => setMapId(m.mapId)}
              >
                {m.floorName}
              </Button>
            ))}
          </div>
        )}
        <FloorMapView
          variant="admin"
          map={map}
          markers={markers}
          onMarkerClick={(id) => {
            setDraft(null);
            onSelect(id.replace(/-draft$/, ''));
          }}
          onMapClick={
            selected
              ? (pos) => setDraft(pos)
              : () => toast.show('오른쪽 목록에서 위치를 지정할 작품을 먼저 선택하세요.')
          }
        />
        <div className={styles.mapFooter}>
          {selected ? (
            <>
              <p className={styles.selectedText}>
                <strong>{selected.title}</strong>
                {draft
                  ? ` · 새 위치 x ${draft.xRatio.toFixed(3)}, y ${draft.yRatio.toFixed(3)}`
                  : positions.get(selected.artworkId)
                    ? ' · 평면도를 클릭하면 위치를 옮길 수 있어요'
                    : ' · 위치 미등록 — 평면도를 클릭해 위치를 지정하세요'}
              </p>
              <div className={styles.footerActions}>
                {draft && (
                  <Button variant="secondary" size="md" onClick={() => setDraft(null)}>
                    취소
                  </Button>
                )}
                <Button
                  size="md"
                  disabled={!draft}
                  loading={savePosition.isPending}
                  onClick={handleSave}
                >
                  위치 저장
                </Button>
              </div>
            </>
          ) : (
            <p className={styles.selectedText}>작품을 선택한 뒤 지도 위치를 지정합니다.</p>
          )}
        </div>
      </section>

      <aside className={styles.listPanel}>
        <h2 className={styles.listTitle}>작품 위치</h2>
        {artworks.length === 0 ? (
          <EmptyState title="이 전시에 등록된 작품이 없어요" />
        ) : (
          <ul className={styles.list}>
            {artworks.map((a, i) => {
              const pos = positions.get(a.artworkId);
              return (
                <li key={a.artworkId}>
                  <button
                    type="button"
                    className={`${styles.item} ${a.artworkId === selectedArtworkId ? styles.itemOn : ''}`}
                    onClick={() => {
                      setDraft(null);
                      onSelect(a.artworkId === selectedArtworkId ? null : a.artworkId);
                    }}
                  >
                    <span>
                      {i + 1}&nbsp;&nbsp;{a.title} · {a.roomName || '전시실 미지정'}
                    </span>
                    {!pos && <span className={styles.unset}>미등록</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className={styles.help}>작품을 선택한 뒤 지도 위치를 지정합니다.</p>
        {selected && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(paths.adminArtworkEdit(selected.artworkId))}
          >
            작품 정보 수정
          </Button>
        )}
      </aside>
    </div>
  );
}

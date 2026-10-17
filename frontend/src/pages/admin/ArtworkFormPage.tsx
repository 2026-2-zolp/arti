import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@/api/types';
import {
  Button,
  Input,
  QueryState,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@/components/common';
import { AdminPageHeader, AdminPanel } from '@/components/layout/AdminLayout';
import {
  useAdminArtwork,
  useAdminExhibitions,
  useAdminMap,
  useSaveArtwork,
} from '@/hooks/queries/useAdminQueries';
import { paths, withQuery } from '@/routes/paths';
import type { Artwork, ArtworkInput } from '@/types/domain';
import admin from './admin.module.css';
import styles from './ArtworkFormPage.module.css';
import { REVIEW_STATUS_OPTIONS } from './labels';

function toInput(artwork: Artwork | null, exhibitionId: string): ArtworkInput {
  return {
    exhibitionId: artwork?.exhibitionId ?? exhibitionId,
    title: artwork?.title ?? '',
    artist: artwork?.artist ?? '',
    year: artwork?.year ?? '',
    imageUrl: artwork?.imageUrl ?? '',
    floorId: artwork?.floorId ?? '',
    roomName: artwork?.roomName ?? '',
    description: artwork?.description ?? '',
    guidedLooking: artwork?.guidedLooking ?? [],
    source: artwork?.source ?? '',
    referenceUrl: artwork?.referenceUrl ?? '',
    reviewStatus: artwork?.reviewStatus ?? 'pending',
    tasteTags: artwork?.tasteTags ?? [],
  };
}

/** A-04 작품 등록·수정 (/admin/artworks/new, /admin/artworks/:artworkId/edit) */
export function ArtworkFormPage() {
  const { artworkId } = useParams();
  const query = useAdminArtwork(artworkId);
  const [searchParams] = useSearchParams();

  if (artworkId) {
    return (
      <QueryState
        query={query}
        loading={<Skeleton height={640} radius={20} />}
        errorTitle="작품 정보를 불러오지 못했어요"
      >
        {(artwork) => <ArtworkForm key={artwork.artworkId} artwork={artwork} />}
      </QueryState>
    );
  }
  return (
    <ArtworkForm artwork={null} defaultExhibitionId={searchParams.get('exhibitionId') ?? ''} />
  );
}

function ArtworkForm({
  artwork,
  defaultExhibitionId = '',
}: {
  artwork: Artwork | null;
  defaultExhibitionId?: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const exhibitions = useAdminExhibitions();
  const save = useSaveArtwork();
  const [form, setForm] = useState<ArtworkInput>(() => toInput(artwork, defaultExhibitionId));
  const [errors, setErrors] = useState<Partial<Record<keyof ArtworkInput, string>>>({});
  const map = useAdminMap(form.exhibitionId || undefined);
  const rooms =
    map.data?.maps.flatMap((m) =>
      m.rooms.map((r) => ({ ...r, floorId: m.floorId, floorName: m.floorName })),
    ) ?? [];

  const set = <K extends keyof ArtworkInput>(key: K, value: ArtworkInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!form.title.trim()) next.title = '작품명을 입력해 주세요.';
    if (!form.artist.trim()) next.artist = '작가를 입력해 주세요.';
    if (!form.exhibitionId) next.exhibitionId = '전시를 선택해 주세요.';
    if (form.referenceUrl && !/^https?:\/\//.test(form.referenceUrl)) {
      next.referenceUrl = 'http(s):// 로 시작하는 URL 을 입력해 주세요.';
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    save.mutate(
      { artworkId: artwork?.artworkId, input: form },
      {
        onSuccess: (saved) => {
          toast.success('작품 정보를 저장했어요');
          if (!artwork) navigate(paths.adminArtworkEdit(saved.artworkId), { replace: true });
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  };

  return (
    <>
      <AdminPageHeader
        title="작품 등록·수정"
        description="작품 정보와 설명, 출처·참고자료, 검수 상태를 함께 관리합니다."
        actions={
          <>
            <Button variant="secondary" size="md" onClick={() => navigate(paths.adminArtworks)}>
              목록
            </Button>
            {artwork && (
              <Button
                variant="secondary"
                size="md"
                onClick={() =>
                  navigate(
                    withQuery(paths.adminMap, {
                      exhibitionId: artwork.exhibitionId,
                      artworkId: artwork.artworkId,
                    }),
                  )
                }
              >
                위치·지도 관리
              </Button>
            )}
          </>
        }
      />

      <form className={styles.grid} onSubmit={handleSubmit} noValidate>
        <AdminPanel title="기본 정보">
          <div className={styles.fields}>
            <Select
              tone="admin"
              label="전시"
              placeholder="전시 선택"
              value={form.exhibitionId}
              error={errors.exhibitionId}
              options={(exhibitions.data ?? []).map((e) => ({
                value: e.exhibitionId,
                label: e.title,
              }))}
              onChange={(e) => {
                set('exhibitionId', e.target.value);
                set('roomName', '');
              }}
            />
            <Input
              tone="admin"
              label="작품명"
              value={form.title}
              error={errors.title}
              onChange={(e) => set('title', e.target.value)}
            />
            <Input
              tone="admin"
              label="작가"
              value={form.artist}
              error={errors.artist}
              onChange={(e) => set('artist', e.target.value)}
            />
            <Input
              tone="admin"
              label="제작연도"
              value={form.year}
              onChange={(e) => set('year', e.target.value)}
            />
            <Select
              tone="admin"
              label="전시실 / 위치"
              placeholder={form.exhibitionId ? '전시실 선택' : '전시를 먼저 선택하세요'}
              value={form.roomName}
              options={rooms.map((r) => ({ value: r.name, label: `${r.floorName} · ${r.name}` }))}
              onChange={(e) => {
                const room = rooms.find((r) => r.name === e.target.value);
                set('roomName', e.target.value);
                if (room) set('floorId', room.floorId);
              }}
              hint="지도 좌표는 ‘위치·지도 관리’에서 지정합니다."
            />
            <Input
              tone="admin"
              label="작품 이미지 URL"
              value={form.imageUrl.startsWith('data:') ? '' : form.imageUrl}
              placeholder={
                form.imageUrl.startsWith('data:')
                  ? '임시 생성 이미지 사용 중 — URL 을 입력하면 교체됩니다'
                  : 'https://'
              }
              onChange={(e) => {
                const original = artwork?.imageUrl ?? '';
                set('imageUrl', e.target.value || (original.startsWith('data:') ? original : ''));
              }}
            />
            {form.imageUrl && (
              <img src={form.imageUrl} alt="작품 이미지 미리보기" className={styles.preview} />
            )}
          </div>
        </AdminPanel>

        <AdminPanel title="설명 및 검수">
          <div className={styles.fields}>
            <Textarea
              tone="admin"
              label="작품 해설"
              rows={5}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
            <Textarea
              tone="admin"
              label="Guided Looking 질문 (한 줄에 하나)"
              rows={3}
              value={form.guidedLooking.join('\n')}
              onChange={(e) => set('guidedLooking', e.target.value.split('\n'))}
            />
            <Input
              tone="admin"
              label="출처"
              value={form.source}
              onChange={(e) => set('source', e.target.value)}
            />
            <Input
              tone="admin"
              label="참고자료 URL"
              value={form.referenceUrl}
              error={errors.referenceUrl}
              placeholder="https://"
              onChange={(e) => set('referenceUrl', e.target.value)}
            />
            <div className={styles.bottomRow}>
              <Select
                tone="admin"
                label="검수 상태"
                value={form.reviewStatus}
                options={REVIEW_STATUS_OPTIONS}
                onChange={(e) =>
                  set('reviewStatus', e.target.value as ArtworkInput['reviewStatus'])
                }
              />
              <Button type="submit" size="md" loading={save.isPending} className={styles.save}>
                저장
              </Button>
            </div>
          </div>
        </AdminPanel>
      </form>
      <p className={admin.muted} style={{ marginTop: 16 }}>
        작품 해설과 AI 응답에 사용할 데이터의 신뢰성을 위해 출처·참고자료·검수 상태를 함께
        관리합니다.
      </p>
    </>
  );
}

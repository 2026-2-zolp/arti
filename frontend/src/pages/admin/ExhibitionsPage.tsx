import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '@/api/types';
import {
  Button,
  EmptyState,
  Icon,
  Input,
  Modal,
  QueryState,
  Select,
  SkeletonList,
  useToast,
} from '@/components/common';
import { AdminPageHeader, AdminPanel } from '@/components/layout/AdminLayout';
import { useAdminExhibitions, useSaveExhibition } from '@/hooks/queries/useAdminQueries';
import { paths, withQuery } from '@/routes/paths';
import type { Exhibition, ExhibitionInput } from '@/types/domain';
import { formatPeriod, todayISODate } from '@/utils/format';
import admin from './admin.module.css';
import { EXHIBITION_STATUS_LABEL, EXHIBITION_STATUS_OPTIONS } from './labels';

const EMPTY_FORM: ExhibitionInput = {
  title: '',
  subtitle: '',
  venue: '',
  place: '',
  startDate: todayISODate(),
  endDate: todayISODate(),
  status: 'scheduled',
};

/** A-03 전시 관리 */
export function ExhibitionsPage() {
  const navigate = useNavigate();
  const query = useAdminExhibitions();
  const [editing, setEditing] = useState<Exhibition | 'new' | null>(null);

  return (
    <>
      <AdminPageHeader
        title="전시 관리"
        description="서비스에 제공할 전시의 기본 정보와 운영 상태를 관리합니다."
        actions={
          <Button
            size="md"
            leftIcon={<Icon name="plus" size={18} />}
            onClick={() => setEditing('new')}
          >
            전시 등록
          </Button>
        }
      />

      <AdminPanel className={admin.panelMin}>
        <QueryState
          query={query}
          loading={<SkeletonList count={3} itemHeight={56} />}
          empty={
            <EmptyState
              title="등록된 전시가 없어요"
              description="‘전시 등록’으로 새 전시를 추가하세요."
            />
          }
        >
          {(exhibitions) => (
            <table className={admin.table}>
              <thead>
                <tr>
                  <th style={{ width: '24%' }}>전시명</th>
                  <th style={{ width: '20%' }}>기간</th>
                  <th style={{ width: '18%' }}>장소</th>
                  <th style={{ width: '9%' }}>작품 수</th>
                  <th style={{ width: '10%' }}>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {exhibitions.map((ex) => (
                  <tr key={ex.exhibitionId}>
                    <td>
                      {ex.title}
                      <div className={admin.muted}>/exhibition/{ex.exhibitionId}</div>
                    </td>
                    <td>{formatPeriod(ex.startDate, ex.endDate)}</td>
                    <td>{ex.place || ex.venue}</td>
                    <td>{ex.artworkCount}</td>
                    <td>{EXHIBITION_STATUS_LABEL[ex.status]}</td>
                    <td>
                      <div className={admin.actions}>
                        <button
                          type="button"
                          className={admin.linkButton}
                          onClick={() => setEditing(ex)}
                        >
                          {ex.status === 'closed' ? '보기' : '수정'}
                        </button>
                        <button
                          type="button"
                          className={admin.linkButton}
                          onClick={() =>
                            navigate(
                              withQuery(paths.adminArtworks, { exhibitionId: ex.exhibitionId }),
                            )
                          }
                        >
                          작품 관리
                        </button>
                        <button
                          type="button"
                          className={admin.linkButton}
                          onClick={() =>
                            navigate(withQuery(paths.adminMap, { exhibitionId: ex.exhibitionId }))
                          }
                        >
                          지도
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
      </AdminPanel>

      {editing && (
        <ExhibitionFormModal
          exhibition={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ExhibitionFormModal({
  exhibition,
  onClose,
}: {
  exhibition: Exhibition | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveExhibition();
  const [form, setForm] = useState<ExhibitionInput>(() =>
    exhibition
      ? {
          title: exhibition.title,
          subtitle: exhibition.subtitle,
          venue: exhibition.venue,
          place: exhibition.place,
          startDate: exhibition.startDate,
          endDate: exhibition.endDate,
          status: exhibition.status,
        }
      : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ExhibitionInput>(key: K, value: ExhibitionInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setError('전시명을 입력해 주세요.');
    if (form.startDate > form.endDate) return setError('종료일은 시작일 이후여야 해요.');
    setError(null);
    save.mutate(
      { exhibitionId: exhibition?.exhibitionId, input: form },
      {
        onSuccess: () => {
          toast.success(exhibition ? '전시 정보를 수정했어요' : '새 전시를 등록했어요');
          onClose();
        },
      },
    );
  };

  const message = error ?? (save.isError ? getErrorMessage(save.error) : null);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={exhibition ? '전시 수정' : '전시 등록'}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            취소
          </Button>
          <Button size="md" type="submit" form="exhibition-form" loading={save.isPending}>
            저장
          </Button>
        </>
      }
    >
      <form id="exhibition-form" className={admin.formGrid} onSubmit={handleSubmit} noValidate>
        <div className={admin.span2}>
          <Input
            tone="admin"
            label="전시명"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>
        <div className={admin.span2}>
          <Input
            tone="admin"
            label="소개 문구 (U-01 ‘현재 전시’에 표시)"
            value={form.subtitle}
            onChange={(e) => set('subtitle', e.target.value)}
          />
        </div>
        <Input
          tone="admin"
          label="기관"
          value={form.venue}
          onChange={(e) => set('venue', e.target.value)}
        />
        <Input
          tone="admin"
          label="장소"
          value={form.place}
          onChange={(e) => set('place', e.target.value)}
        />
        <Input
          tone="admin"
          label="시작일"
          type="date"
          value={form.startDate}
          onChange={(e) => set('startDate', e.target.value)}
        />
        <Input
          tone="admin"
          label="종료일"
          type="date"
          value={form.endDate}
          onChange={(e) => set('endDate', e.target.value)}
        />
        <Select
          tone="admin"
          label="운영 상태"
          options={EXHIBITION_STATUS_OPTIONS}
          value={form.status}
          onChange={(e) => set('status', e.target.value as ExhibitionInput['status'])}
        />
        {message && (
          <p
            className={admin.span2}
            role="alert"
            style={{ color: 'var(--color-danger)', fontSize: 14 }}
          >
            {message}
          </p>
        )}
      </form>
    </Modal>
  );
}

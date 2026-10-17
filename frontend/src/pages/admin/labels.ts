import type { ExhibitionStatus, MemberStatus, ReviewStatus } from '@/types/domain';

export const REVIEW_STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: 'pending', label: '검수 대기' },
  { value: 'source_check', label: '출처 확인' },
  { value: 'approved', label: '검수 완료' },
];

export const REVIEW_STATUS_LABEL = Object.fromEntries(
  REVIEW_STATUS_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ReviewStatus, string>;

export const REVIEW_STATUS_TONE: Record<ReviewStatus, 'warning' | 'neutral' | 'success'> = {
  pending: 'warning',
  source_check: 'neutral',
  approved: 'success',
};

export const EXHIBITION_STATUS_OPTIONS: { value: ExhibitionStatus; label: string }[] = [
  { value: 'scheduled', label: '운영 예정' },
  { value: 'active', label: '운영 중' },
  { value: 'closed', label: '종료' },
];

export const EXHIBITION_STATUS_LABEL = Object.fromEntries(
  EXHIBITION_STATUS_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ExhibitionStatus, string>;

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: '정상',
  suspended: '정지',
};

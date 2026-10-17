import { useParams } from 'react-router-dom';

export function useExhibitionId() {
  const { exhibitionId } = useParams<{ exhibitionId: string }>();
  return exhibitionId ?? '';
}

export function useArtworkId() {
  const { artworkId } = useParams<{ artworkId: string }>();
  return artworkId ?? '';
}

/** 앱 내부 이전 기록이 있는지 (외부 URL 직접 진입이면 false) */
export function hasAppHistory() {
  return ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
}

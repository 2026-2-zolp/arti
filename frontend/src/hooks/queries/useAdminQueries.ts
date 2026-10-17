import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { adminApi } from '@/api/services/admin.api';
import type { ArtworkInput, ExhibitionInput } from '@/types/domain';

export function useDashboard() {
  return useQuery({ queryKey: queryKeys.dashboard.summary(), queryFn: adminApi.getDashboard });
}

export function useAdminExhibitions() {
  return useQuery({
    queryKey: queryKeys.exhibitions.adminList(),
    queryFn: adminApi.getExhibitions,
  });
}

export function useSaveExhibition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ exhibitionId, input }: { exhibitionId?: string; input: ExhibitionInput }) =>
      exhibitionId
        ? adminApi.updateExhibition(exhibitionId, input)
        : adminApi.createExhibition(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exhibitions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useAdminArtworks(exhibitionId?: string) {
  return useQuery({
    queryKey: queryKeys.artworks.adminList(exhibitionId),
    queryFn: () => adminApi.getArtworks(exhibitionId),
  });
}

export function useAdminArtwork(artworkId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.artworks.adminDetail(artworkId ?? ''),
    queryFn: () => adminApi.getArtwork(artworkId!),
    enabled: Boolean(artworkId),
  });
}

export function useSaveArtwork() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ artworkId, input }: { artworkId?: string; input: ArtworkInput }) =>
      artworkId ? adminApi.updateArtwork(artworkId, input) : adminApi.createArtwork(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.artworks.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.exhibitions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.recommendations.all });
    },
  });
}

export function useAdminMap(exhibitionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.maps.adminExhibition(exhibitionId ?? ''),
    queryFn: () => adminApi.getMap(exhibitionId!),
    enabled: Boolean(exhibitionId),
  });
}

export function useSavePosition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { mapId: string; artworkId: string; xRatio: number; yRatio: number }) =>
      adminApi.savePosition(v.mapId, v.artworkId, v.xRatio, v.yRatio),
    onSuccess: () => {
      // 관리자/사용자 지도 모두 같은 좌표를 쓰므로 maps 전체를 갱신
      queryClient.invalidateQueries({ queryKey: queryKeys.maps.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.artworks.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

export function useMembers(keyword: string) {
  return useQuery({
    queryKey: queryKeys.members.list(keyword),
    queryFn: () => adminApi.getMembers(keyword),
    placeholderData: keepPreviousData,
  });
}

export function useMember(userId: string | null) {
  return useQuery({
    queryKey: queryKeys.members.detail(userId ?? ''),
    queryFn: () => adminApi.getMember(userId!),
    enabled: Boolean(userId),
  });
}

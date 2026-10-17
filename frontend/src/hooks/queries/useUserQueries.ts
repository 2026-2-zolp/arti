import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { aiApi } from '@/api/services/ai.api';
import { meApi } from '@/api/services/auth.api';
import { exhibitionApi } from '@/api/services/exhibition.api';
import type { ChatMessage, VisitRecord, VisitTimeOption } from '@/types/domain';

// ---- 전시 / 작품 ----

export function useExhibition(exhibitionId: string) {
  return useQuery({
    queryKey: queryKeys.exhibitions.detail(exhibitionId),
    queryFn: () => exhibitionApi.getExhibition(exhibitionId),
  });
}

export function useTasteOptions(exhibitionId: string) {
  return useQuery({
    queryKey: queryKeys.tastes.options(exhibitionId),
    queryFn: () => exhibitionApi.getTasteOptions(exhibitionId),
    staleTime: 10 * 60_000,
  });
}

export function useRecommendations(
  exhibitionId: string,
  tasteIds: string[],
  timeOption: VisitTimeOption | null,
) {
  return useQuery({
    queryKey: queryKeys.recommendations.list(exhibitionId, tasteIds, timeOption ?? ''),
    queryFn: () => exhibitionApi.getRecommendations(exhibitionId, tasteIds, timeOption!),
    enabled: Boolean(timeOption) && tasteIds.length > 0,
    staleTime: Infinity,
  });
}

export function useArtwork(exhibitionId: string, artworkId: string) {
  return useQuery({
    queryKey: queryKeys.artworks.detail(exhibitionId, artworkId),
    queryFn: () => exhibitionApi.getArtwork(exhibitionId, artworkId),
  });
}

export function useExhibitionMap(exhibitionId: string) {
  return useQuery({
    queryKey: queryKeys.maps.exhibition(exhibitionId),
    queryFn: () => exhibitionApi.getMap(exhibitionId),
  });
}

// ---- AI ----

export function useAiExplanation(artworkId: string, tasteIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.ai.explanation(artworkId, tasteIds),
    queryFn: () => aiApi.getExplanation(artworkId, tasteIds),
    enabled,
    staleTime: Infinity,
  });
}

export function useSuggestedQuestions(artworkId: string) {
  return useQuery({
    queryKey: queryKeys.ai.suggestedQuestions(artworkId),
    queryFn: () => aiApi.getSuggestedQuestions(artworkId),
    staleTime: Infinity,
  });
}

export function useAskAi(artworkId: string) {
  return useMutation({
    mutationFn: ({ question, history }: { question: string; history: ChatMessage[] }) =>
      aiApi.ask(artworkId, question, history),
  });
}

// ---- 내 취향 / 관람 기록 (로그인 사용자) ----

export function useMyTaste(enabled = true) {
  return useQuery({
    queryKey: queryKeys.tastes.mine(),
    queryFn: meApi.getTaste,
    enabled,
  });
}

export function useSaveMyTaste() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tasteIds: string[]) => meApi.saveTaste(tasteIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tastes.all }),
  });
}

export function useMyVisits() {
  return useQuery({ queryKey: queryKeys.visits.list(), queryFn: meApi.getVisits });
}

export function useMyVisit(visitId: string) {
  return useQuery({
    queryKey: queryKeys.visits.detail(visitId),
    queryFn: () => meApi.getVisit(visitId),
  });
}

export function useSaveVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (record: Omit<VisitRecord, 'visitId'>) => meApi.saveVisit(record),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.visits.all }),
  });
}

import type {
  Artwork,
  Exhibition,
  ExhibitionMapData,
  RecommendationResult,
  TasteOption,
  VisitTimeOption,
} from '@/types/domain';
import { apiClient, unwrap } from '../client';
import type { ApiResponse } from '../types';

export const exhibitionApi = {
  getExhibition: (exhibitionId: string) =>
    apiClient.get<ApiResponse<Exhibition>>(`/exhibitions/${exhibitionId}`).then(unwrap),

  getTasteOptions: (exhibitionId: string) =>
    apiClient
      .get<ApiResponse<TasteOption[]>>(`/exhibitions/${exhibitionId}/taste-options`)
      .then(unwrap),

  getRecommendations: (exhibitionId: string, tasteIds: string[], timeOption: VisitTimeOption) =>
    apiClient
      .post<ApiResponse<RecommendationResult>>(`/exhibitions/${exhibitionId}/recommendations`, {
        tasteIds,
        timeOption,
      })
      .then(unwrap),

  getArtwork: (exhibitionId: string, artworkId: string) =>
    apiClient
      .get<ApiResponse<Artwork>>(`/exhibitions/${exhibitionId}/artworks/${artworkId}`)
      .then(unwrap),

  getMap: (exhibitionId: string) =>
    apiClient.get<ApiResponse<ExhibitionMapData>>(`/exhibitions/${exhibitionId}/map`).then(unwrap),
};

import type {
  Artwork,
  ArtworkInput,
  ArtworkPosition,
  DashboardSummary,
  Exhibition,
  ExhibitionInput,
  ExhibitionMapData,
  Member,
  MemberDetail,
} from '@/types/domain';
import { apiClient, unwrap } from '../client';
import type { ApiResponse } from '../types';

export const adminApi = {
  getDashboard: () => apiClient.get<ApiResponse<DashboardSummary>>('/admin/dashboard').then(unwrap),

  getExhibitions: () => apiClient.get<ApiResponse<Exhibition[]>>('/admin/exhibitions').then(unwrap),

  createExhibition: (input: ExhibitionInput) =>
    apiClient.post<ApiResponse<Exhibition>>('/admin/exhibitions', input).then(unwrap),

  updateExhibition: (exhibitionId: string, input: Partial<ExhibitionInput>) =>
    apiClient
      .put<ApiResponse<Exhibition>>(`/admin/exhibitions/${exhibitionId}`, input)
      .then(unwrap),

  getArtworks: (exhibitionId?: string) =>
    apiClient
      .get<ApiResponse<Artwork[]>>('/admin/artworks', { params: { exhibitionId } })
      .then(unwrap),

  getArtwork: (artworkId: string) =>
    apiClient.get<ApiResponse<Artwork>>(`/admin/artworks/${artworkId}`).then(unwrap),

  createArtwork: (input: ArtworkInput) =>
    apiClient.post<ApiResponse<Artwork>>('/admin/artworks', input).then(unwrap),

  updateArtwork: (artworkId: string, input: Partial<ArtworkInput>) =>
    apiClient.put<ApiResponse<Artwork>>(`/admin/artworks/${artworkId}`, input).then(unwrap),

  getMap: (exhibitionId: string) =>
    apiClient
      .get<ApiResponse<ExhibitionMapData>>(`/admin/exhibitions/${exhibitionId}/map`)
      .then(unwrap),

  savePosition: (mapId: string, artworkId: string, xRatio: number, yRatio: number) =>
    apiClient
      .put<ApiResponse<ArtworkPosition>>(`/admin/maps/${mapId}/positions/${artworkId}`, {
        xRatio,
        yRatio,
      })
      .then(unwrap),

  getMembers: (keyword: string) =>
    apiClient.get<ApiResponse<Member[]>>('/admin/members', { params: { keyword } }).then(unwrap),

  getMember: (userId: string) =>
    apiClient.get<ApiResponse<MemberDetail>>(`/admin/members/${userId}`).then(unwrap),
};

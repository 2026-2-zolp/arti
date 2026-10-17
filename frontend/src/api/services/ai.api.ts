import type { ChatMessage } from '@/types/domain';
import { apiClient, unwrap } from '../client';
import type { ApiResponse } from '../types';

export const aiApi = {
  getExplanation: (artworkId: string, tasteIds: string[]) =>
    apiClient
      .post<ApiResponse<{ content: string }>>(`/artworks/${artworkId}/ai/explanation`, { tasteIds })
      .then(unwrap),

  getSuggestedQuestions: (artworkId: string) =>
    apiClient
      .get<ApiResponse<string[]>>(`/artworks/${artworkId}/ai/suggested-questions`)
      .then(unwrap),

  ask: (artworkId: string, question: string, history: ChatMessage[]) =>
    apiClient
      .post<ApiResponse<ChatMessage>>(`/artworks/${artworkId}/ai/questions`, { question, history })
      .then(unwrap),
};

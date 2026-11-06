/**
 * 작품 👍/👎와 이유를 이 브라우저에 모아 둔다.
 * 관리자 화면이 같은 기기에서 평가를 볼 수 있게 하는 프론트 기록이다.
 */
import type { Reaction } from '../types';
import { load, save } from './storage';

export interface ReactionLogItem {
  artworkId: string;
  reaction: Reaction;
  reason: string;
  at: string;
}

const KEY = 'arti.reactionLog';

export function readReactionLog(): ReactionLogItem[] {
  const items = load<ReactionLogItem[]>(KEY, []);
  return Array.isArray(items) ? items : [];
}

export function upsertReactionLog(item: Omit<ReactionLogItem, 'at'>): void {
  const rest = readReactionLog().filter((r) => r.artworkId !== item.artworkId);
  save(KEY, [{ ...item, at: new Date().toISOString() }, ...rest]);
}

export function removeReactionLog(artworkId: string): void {
  save(
    KEY,
    readReactionLog().filter((r) => r.artworkId !== artworkId),
  );
}

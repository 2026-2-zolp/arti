/** 취향 확인과 관람 반영의 비교·저장 계약입니다. */
import type { TasteProfile, TasteTag, User } from '../types';
import type { VisitState } from '../store/visitReducer';
import { load } from './storage';

export function tasteScope(state: VisitState) {
  return JSON.stringify([state.user?.id ?? null, state.exhibitionId, state.visitId, state.requestGeneration]);
}

export function authSession() {
  return load<string | null>('arti.token', null);
}

export function sameTaste(left?: TasteProfile | null, right?: TasteProfile | null) {
  if (!left || !right) return left === right;
  const canonical = (p: TasteProfile) => JSON.stringify([
    p.version, p.source, p.poolVersion, p.tieContextVersion ?? null, p.savedProfileVersion ?? null,
    [...p.selectedTags].sort(),
    [...p.picks].sort((a, b) => a.pairIndex - b.pairIndex).map(pick => [pick.pairIndex, pick.artworkId]),
    Object.entries(p.counts).filter(([, value]) => value !== 0).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return canonical(left) === canonical(right);
}

export interface TastePreview {
  tasteProfile: TasteProfile;
  tagOrder: TasteTag[];
  groups: { tags: TasteTag[]; rule: string }[];
  userConfirmed: false;
  visitEvidenceReceipt?: string;
}

export interface TasteMutation {
  expectedSavedProfileVersion: number;
  clientMutationId: string;
}

export async function saveConfirmedTaste({
  account, profile, mutation, acknowledged, put, getUser, isCurrent, onAcknowledged,
}: {
  account: User;
  profile: TasteProfile;
  mutation: TasteMutation;
  acknowledged: boolean;
  put: () => Promise<void>;
  getUser: () => Promise<User>;
  isCurrent: () => boolean;
  onAcknowledged: () => void;
}): Promise<User | undefined> {
  if (!isCurrent()) return;
  if (!acknowledged) {
    await put();
    if (!isCurrent()) return;
    onAcknowledged();
  }
  const user = await getUser();
  if (!isCurrent()) return;
  const version = user.tasteProfileVersion ?? 1;
  const expected = mutation.expectedSavedProfileVersion;
  if (user.id !== account.id || (profile.version === 2 &&
      ((version !== expected && version !== expected + 1) || !sameTaste(user.tasteProfile, profile)))) {
    throw new Error('계정 취향이 바뀌었어요. 이번 관람만 적용하거나 계정의 최신 취향을 확인해 주세요.');
  }
  return user;
}

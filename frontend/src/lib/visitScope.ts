import type { EntryContext } from '../types';
export function newVisitId(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error('안전한 관람 식별자를 만들 수 없어요. 지원 브라우저에서 다시 열어 주세요.');
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function scopeKey(s: { user: {id: string} | null; visitId: string; exhibitionId: string | null }, artworkId: string, contentVersion: number) {
  return `arti.scope.${s.user ? 'user.' + s.user.id : 'guest'}.${s.visitId}.${s.exhibitionId}.${artworkId}.${contentVersion}`;
}
export function clearPrivateCaches(includePending = true) {
  for (const storage of [sessionStorage, localStorage]) for (const key of Object.keys(storage)) {
    if (key.startsWith('arti.scope.') || key.startsWith('arti.chat.') || key.startsWith('arti.receipt.') ||
        key === 'arti.reactionLog' || (includePending && key.startsWith('arti.pendingReceipt.'))) storage.removeItem(key);
  }
}
export type ReadingState = { tab: 'desc' | 'guided'; summaryOn: boolean; expanded: boolean; openHints: number[]; scroll: number; entry?: EntryContext };

export const BASIC_LOOKING_TIPS = [
 '그림에서 가장 밝은 곳을 먼저 찾아보세요. 눈이 가장 먼저 가는 곳이에요.',
 '화면에서 가장 넓게 쓰인 색은 무엇인가요?',
 '조금 떨어져서 한 번, 가까이 다가가서 한 번 보세요. 무엇이 달라 보이나요?',
];

/** Visit-scoped topic signals from ordinary docent questions. */
import type { DocentInterest, DocentInterestSignal } from '../types';
import type { VisitState } from '../store/visitReducer';
import { load, remove, save } from './storage';
import { scopeKey } from './visitScope';

const KEY = 'arti.scope.visitMemory';
const keyFor = (state: VisitState) => scopeKey(state, 'visitor-memory', state.requestGeneration);
type VisitMemoryCache = { scope: string; entries: DocentInterest[]; recapEnabled?: boolean };

export function clearExpiredVisitMemory(state: VisitState) {
  const saved = load<VisitMemoryCache | null>(KEY, null, 'session');
  if (saved && (!state.startedAt || saved.scope !== keyFor(state))) remove(KEY, 'session');
}

function interests(state: VisitState): DocentInterest[] {
  const saved = load<VisitMemoryCache | null>(KEY, null, 'session');
  return state.startedAt && saved?.scope === keyFor(state) && Array.isArray(saved.entries) ? saved.entries : [];
}

export function recordDocentInterest(state: VisitState, artworkId: string, contentVersion: number, signal: DocentInterestSignal, recapEnabled = true) {
  if (!state.startedAt || state.recommendations[state.current]?.artworkId !== artworkId) return;
  const entries = interests(state);
  const previous = entries.find(entry => entry.artworkId === artworkId && entry.contentVersion === contentVersion);
  const topics = [...new Set([...signal.topics, ...(previous?.topics ?? [])])].slice(0, 3);
  const entry = { artworkId, contentVersion, topics, style: signal.style ?? previous?.style ?? null };
  save(KEY, { scope: keyFor(state), entries: [...entries.filter(item => item.artworkId !== artworkId), entry].slice(-12), recapEnabled }, 'session');
}

export function finishedDocentInterests(state: VisitState): DocentInterest[] {
  if (load<VisitMemoryCache | null>(KEY, null, 'session')?.recapEnabled === false) return [];
  return state.user && state.current >= state.recommendations.length
    ? interests(state).filter(entry => state.viewed.includes(entry.artworkId)) : [];
}

export function visitorMemory(state: VisitState) {
  const earlierIds = new Set(state.recommendations.slice(0, state.current).map(item => item.artworkId));
  const viewed = state.viewed.filter(id => earlierIds.has(id));
  const likedTags = viewed.filter(id => state.reactions[id] === 'like')
    .flatMap(id => state.receiptArtworks[id]?.snapshot.tags ?? []);
  return {
    ownerId: state.user?.id ?? null,
    earlier: interests(state).filter(entry => viewed.includes(entry.artworkId)).slice(-3),
    preferredTags: [...new Set([...state.tastes, ...likedTags])].slice(0, 8),
  };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, type VisitState } from '../src/store/visitReducer.ts';
import { clearExpiredVisitMemory, finishedDocentInterests, recordDocentInterest, visitorMemory } from '../src/lib/visitMemory.ts';

function visit(): VisitState {
  const values = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage } });
  return {
    ...init(), user: { id: 'owner' } as NonNullable<VisitState['user']>,
    exhibitionId: 'ex', startedAt: 1, current: 0,
    recommendations: ['a', 'b', 'c'].map((artworkId, index) => ({
      artworkId, order: index + 1, score: 1, matchedTags: [], reason: '',
    })),
  };
}

test('compacts current-work topics and limits later requests to earlier completed works', () => {
  const state = visit();
  recordDocentInterest(state, 'b', 1, { topics: ['color'], style: null });
  recordDocentInterest(state, 'a', 1, { topics: ['light'], style: 'simple' });
  recordDocentInterest(state, 'a', 1, { topics: ['color'], style: null });
  const entry = { artworkId: 'a', contentVersion: 1, topics: ['color', 'light'], style: 'simple' };
  assert.deepEqual(visitorMemory(state).earlier, []);
  assert.deepEqual(visitorMemory({ ...state, current: 1, viewed: ['a', 'b'] }).earlier, [entry]);
  assert.deepEqual(finishedDocentInterests({ ...state, current: 3, viewed: ['a'] }), [entry]);
  assert.deepEqual(finishedDocentInterests({ ...state, current: 3, viewed: ['a'], user: null }), []);
});

test('an older visit, exhibition, route generation or account cannot restore cached topics', () => {
  const state = visit();
  for (const next of [{ ...state, visitId: 'new' }, { ...state, user: null },
    { ...state, exhibitionId: 'other' }, { ...state, requestGeneration: state.requestGeneration + 1 }]) {
    recordDocentInterest(state, 'a', 1, { topics: ['light'], style: null });
    assert.deepEqual(visitorMemory({ ...next, current: 1, viewed: ['a'] }).earlier, []);
    clearExpiredVisitMemory(next);
    assert.deepEqual(visitorMemory({ ...state, current: 1, viewed: ['a'] }).earlier, []);
  }
});

test('same-visit interests help the next artwork and stay out of the receipt payload', () => {
  const state = visit();
  recordDocentInterest(state, 'a', 1, { topics: ['light'], style: 'simple' }, false);
  assert.equal(visitorMemory({ ...state, current: 1, viewed: ['a'] }).earlier.length, 1);
  assert.deepEqual(finishedDocentInterests({ ...state, current: 3, viewed: ['a'] }), []);
});

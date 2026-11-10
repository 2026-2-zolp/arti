import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameTaste, saveConfirmedTaste, tasteScope } from '../src/lib/tasteFlow.ts';
import { buildRecord } from '../src/lib/receiptPayload.ts';
import { init, reducer } from '../src/store/visitReducer.ts';
import type { Exhibition, TasteProfile, User } from '../src/types.ts';

const profile: TasteProfile = { version: 2, source: 'picks', selectedTags: ['warm', 'cool'], counts: { warm: 3, cool: 2 },
  poolVersion: 'pool', tieContextVersion: 'context', picks: [{ pairIndex: 0, artworkId: 'a' }, { pairIndex: 1, artworkId: 'b' }] };
const account = { id: 'alice', tastes: [], tasteProfileVersion: 1 } as unknown as User;
const latest = { ...account, tastes: profile.selectedTags, tasteProfile: profile, tasteProfileVersion: 2 };
const mutation = { clientMutationId: 'fixture-uuid', expectedSavedProfileVersion: 1 };
const current = () => true;

test('semantic equality ignores list order but checks origin and counts', () => {
  assert.ok(sameTaste(profile, { ...profile, picks: [...profile.picks].reverse(), selectedTags: ['cool', 'warm'] }));
  assert.ok(!sameTaste(profile, { ...profile, tieContextVersion: 'new' }));
  assert.ok(!sameTaste(profile, { ...profile, counts: { warm: 2, cool: 2 } }));
  assert.ok(!sameTaste(profile, { ...profile, source: 'manual' }));
});

test('late application is rejected after actor or visit changes', () => {
  const state = { ...init(), user: account, viewed: ['a'] };
  const action = { type: 'applyTaste' as const, scope: tasteScope(state), visitId: 'new',
    profile, receipt: 'signed', user: latest };
  for (const next of [reducer(state, { type: 'logout' }), reducer(state, { type: 'setExhibition', id: 'other' }),
    reducer(state, { type: 'resetVisit' })]) {
    assert.equal(reducer(next, action), next);
  }
  assert.equal(reducer(state, { ...action, receipt: undefined }), state);
});

test('same taste keeps visit, reaction and receipt even if a preview has another candidate ID', () => {
  const state = { ...init(), tasteProfile: profile, tasteEvidenceReceipt: 'original', viewed: ['a'],
    reactions: { a: 'like' as const }, startedAt: 1 };
  assert.equal(reducer(state, { type: 'applyTaste', scope: tasteScope(state), visitId: 'new',
    profile: { ...profile, selectedTags: ['cool', 'warm'] }, receipt: 'new-signature' }), state);
});

test('initial duration and pending receipt retain the signed visit ID and body', () => {
  const state = init();
  const applied = reducer(state, { type: 'applyTaste', scope: tasteScope(state), visitId: 'signed-id', profile, receipt: 'signed' });
  const timed = reducer(applied, { type: 'setDuration', duration: '30m' });
  const ex = { id: 'ex' } as Exhibition;
  const record = buildRecord(timed, [], ex);
  assert.equal(record.visitId, 'signed-id');
  assert.equal(record.tasteEvidenceReceipt, 'signed');
  const begun = reducer(timed, { type: 'startVisit' });
  assert.equal(reducer(begun, { type: 'setDuration', duration: '60m' }), begun);
  const changed = reducer(begun, { type: 'setDuration', duration: '60m', proof: { visitId: 'another', receipt: 'another-proof' } });
  assert.equal(changed.visitId, 'another');
  assert.equal(buildRecord(changed, [], ex).tasteEvidenceReceipt, 'another-proof');
});

test('acknowledged save retries me only, while conflicts and lost responses never acknowledge', async () => {
  let puts = 0, acknowledgments = 0;
  const inputs = { account, profile, mutation, acknowledged: false, isCurrent: current,
    put: async () => { puts++; }, getUser: async () => latest, onAcknowledged: () => { acknowledgments++; } };
  await assert.rejects(saveConfirmedTaste({ ...inputs, getUser: async () => { throw Error('me failed'); } }), /me failed/);
  assert.equal(acknowledgments, 1);
  assert.equal(await saveConfirmedTaste({ ...inputs, acknowledged: true }), latest);
  assert.equal(puts, 1);
  for (const failure of ['409', 'network loss']) {
    await assert.rejects(saveConfirmedTaste({ ...inputs, put: async () => { throw Error(failure); } }), new RegExp(failure));
  }
  assert.equal(acknowledgments, 1);
});

test('edit or actor change while PUT or me is pending discards completion', async () => {
  for (const phase of ['put', 'me']) {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let active = true, meCalls = 0;
    const result = saveConfirmedTaste({ account, profile, mutation, acknowledged: false,
      isCurrent: () => active, onAcknowledged: () => {},
      put: async () => { if (phase === 'put') await delayed; },
      getUser: async () => { meCalls++; if (phase === 'me') await delayed; return latest; },
    });
    await Promise.resolve();
    active = false;
    release();
    assert.equal(await result, undefined);
    assert.equal(meCalls, phase === 'put' ? 0 : 1);
  }
});

test('newer account profile is never treated as confirmation of the prior save', async () => {
  await assert.rejects(saveConfirmedTaste({ account, profile, mutation, acknowledged: true, isCurrent: current,
    onAcknowledged: () => {}, put: async () => {},
    getUser: async () => ({ ...latest, tasteProfileVersion: 3 }),
  }), /계정 취향이 바뀌었어요/);
});

test('refresh restores the receipt only for the recorded visit owner', () => {
  const state = { ...init(), ownerId: 'alice', tasteEvidenceReceipt: 'signed', tasteProfile: profile };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const sessionStorage = { getItem: () => JSON.stringify(state) };
  let restoredUser = account;
  const localStorage = { getItem: () => JSON.stringify(restoredUser) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage, localStorage } });
  try {
    assert.equal(init().tasteEvidenceReceipt, 'signed');
    restoredUser = { ...account, id: 'bob' };
    assert.equal(init().tasteEvidenceReceipt, undefined);
    assert.notEqual(init().visitId, state.visitId);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

/** 관람 상태 전이·복귀·계정 경계와 취향 이력 보존을 검증합니다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {init,reducer} from '../src/store/visitReducer.ts';
import {newVisitId,scopeKey} from '../src/lib/visitScope.ts';

test('HTTP LAN-compatible UUIDv4 uses secure getRandomValues', () => {
  assert.match(newVisitId(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(newVisitId(),newVisitId());
});
test('taste/time invalidation rejects a late previous-generation recommendation', () => {
  const s=init(); const old=s.requestGeneration;
  const changed=reducer(s,{type:'setDuration',duration:'60m'});
  const late=reducer(changed,{type:'setRecommendations',recs:[{artworkId:'old'} as any],generation:old});
  assert.equal(late.recommendations.length,0);assert.notEqual(changed.visitId,s.visitId);
});
test('explicit new visit with same duration replaces ID and clears progress', () => {
  const s={...init(),duration:'30m' as const,startedAt:1,viewed:['a'],reactionReasons:{a:'색감'}};
  const next=reducer(s,{type:'setDuration',duration:'30m',newVisit:true});
  assert.notEqual(next.visitId,s.visitId);assert.equal(next.startedAt,null);assert.deepEqual(next.viewed,[]);assert.deepEqual(next.reactionReasons,{});
});
test('same-work navigation refresh preserves state; actor/exhibition changes isolate it', () => {
  const s={...init(),exhibitionId:'ex',startedAt:1,viewed:['a']};
  assert.equal(reducer(s,{type:'setExhibition',id:'ex'}),s);
  const ex=reducer(s,{type:'setExhibition',id:'other'});assert.deepEqual(ex.viewed,[]);assert.notEqual(ex.visitId,s.visitId);
  const signed=reducer(s,{type:'login',user:{id:'person',tastes:[]} as any});assert.deepEqual(signed.viewed,[]);
  const out=reducer(signed,{type:'logout'});assert.notEqual(scopeKey(signed,'a',1),scopeKey(out,'a',1));
  assert.notEqual(scopeKey(s,'a',1),scopeKey(s,'a',2));
});
test('frequency provenance survives selection and recommendation storage', () => {
  const profile={version:1 as const,source:'picks' as const,poolVersion:'pool',picks:[{pairIndex:0,artworkId:'a'}],counts:{warm:4},selectedTags:['warm' as const]};
  let s=reducer(init(),{type:'finishTaste',tastes:['warm'],profile});
  s=reducer(s,{type:'setRecommendations',recs:[],generation:s.requestGeneration});
  assert.equal(s.tasteProfile?.counts.warm,4);assert.equal(s.tasteProfile?.picks[0].artworkId,'a');
});

test('same duration preserves recommendations, visit ID and recorded reactions', () => {
  const s={...init(),duration:'30m' as const,startedAt:1,viewed:['a'],reactions:{a:'like' as const},dwell:{a:42},recommendations:[{artworkId:'a'} as any]};
  const next=reducer(s,{type:'setDuration',duration:'30m'});
  assert.equal(next,s);
  assert.equal(next.visitId,s.visitId);
  assert.deepEqual(next.reactions,{a:'like'});
  assert.equal(next.dwell.a,42);
});

test('repeated or stale artwork completion cannot skip the next artwork', () => {
  const initial = init();
  const state = reducer(initial, {
    type: 'setRecommendations',
    recs: ['a', 'b'].map((artworkId, index) => ({
      artworkId, order: index + 1, score: 1, matchedTags: [], reason: '',
    })),
  });
  const action = { type: 'completeCurrent' as const, visitId: state.visitId, artworkId: 'a' };
  assert.equal(reducer(state, { ...action, visitId: 'previous-visit' }), state);
  const next = reducer(state, action);
  assert.equal(next.current, 1);
  assert.deepEqual(next.viewed, ['a']);
  assert.equal(reducer(next, action), next);
  const finished = reducer(next, { ...action, artworkId: 'b' });
  assert.deepEqual(finished.viewed, ['a', 'b']);
  assert.equal(finished.current, 2);
  assert.equal(reducer(finished, { ...action, artworkId: 'b' }), finished);
});

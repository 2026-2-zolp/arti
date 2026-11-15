/** 관람 영수증 요청의 저장 필드·취향 근거를 검증합니다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRecord} from '../src/lib/receiptPayload.ts';
import {init} from '../src/store/visitReducer.ts';

test('incomplete artwork dwell/reactions cannot enter a canonical receipt',()=>{
 const state={...init(),exhibitionId:'ex',viewed:['complete'],dwell:{complete:30,incomplete:90},reactions:{complete:'like' as const,incomplete:'dislike' as const},reactionReasons:{complete:'색감',incomplete:'다른 이유'}};
 const record=buildRecord(state,[],{id:'ex',title:'시험 전시',venue:'가상'} as any);
 assert.deepEqual(record.dwell,{complete:30});assert.deepEqual(record.reactions,{complete:'like'});assert.deepEqual(record.reactionReasons,{complete:'색감'});assert.equal(record.longestViewedArtworkId,'complete');
});
test('zero completed works form an empty valid receipt instead of claiming a viewed work',()=>{
 const state={...init(),exhibitionId:'ex',viewed:[],dwell:{incomplete:12}};
 const record=buildRecord(state,[],{id:'ex',title:'시험 전시',venue:'가상'} as any);
 assert.deepEqual(record.dwell,{});assert.equal(record.longestViewedArtworkId,null);assert.equal(record.visitId,state.visitId);
});

test('equal dwell uses visit order even when the dwell keys arrive in another order', () => {
 const state = {...init(), viewed: ['second', 'first'], dwell: {first: 5, second: 5}};
 const record = buildRecord(state, [], {id: 'ex', title: '시험 전시', venue: '가상'} as any);
 assert.equal(record.longestViewedArtworkId, 'second');
});

test('receipt duration stays inside the save contract after a long visit', () => {
 const state = init();
 const exhibition = {id: 'ex', title: '시험 전시', venue: '가상'} as any;
 const now = Date.now();
 for (const [startedAt, expected] of [[null, 0], [now + 10000, 1], [now - 30 * 60000, 30], [now - 48 * 60 * 60000, 1440]] as const) {
   assert.equal(buildRecord({...state, startedAt}, [], exhibition).durationMin, expected);
 }
});

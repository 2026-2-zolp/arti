/** 장애 복구 후 편집 소실·구버전 반영·미기록 시각의 화면 오류를 막습니다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeAnalysis,analysisFailure,analysisOutcomes,analysisTime,failedAnalysisFields} from '../src/lib/adminAnalysis.ts';
import type {Artwork} from '../src/types.ts';
const base={id:'synthetic',version:1,summary:'확정 원문',summaryStatus:'confirmed',guideIntro:'확정 도입',guidedLooking:['확정 질문'],guidedHints:['확정 힌트'],guideStatus:'confirmed',tagStatus:'suggested',emotionStatus:'suggested',tagScores:null,analysis:null} as Artwork;
const result={artwork:{...base,version:2,analysis:{emotions:{calm:.5}}} as Artwork,tag:{made:true},emotion:{ok:true,made:true},summary:{ok:true,made:false,source:'kept'},guide:{made:false}};
test('recovery preserves unsaved confirmed text while applying fresh analysis',()=>{
 const edit={...base,title:'미저장 이름',summary:'미저장 요약',guideIntro:'미저장 도입'};
 const after=mergeAnalysis(edit,edit,result);
 assert.equal(after.title,edit.title);assert.equal(after.summary,edit.summary);assert.equal(after.guideIntro,edit.guideIntro);assert.deepEqual(after.analysis,result.artwork.analysis);assert.equal(after.version,2);
});
test('edits during inference and newer saved versions cannot be overwritten',()=>{
 const generated={...result,summary:{ok:true,made:true},artwork:{...result.artwork,summary:'생성 초안'}};
 assert.equal(mergeAnalysis({...base,summary:'요청 중 편집'},base,generated).summary,'요청 중 편집');
 const newer={...base,version:3};assert.equal(mergeAnalysis(newer,base,result),newer);
 const other={...base,id:'another'};assert.equal(mergeAnalysis(other,base,result),other);
});
test('status-specific recovery guidance and old missing timestamps stay renderable',()=>{
 for(const status of [429,502,503,504])assert.match(analysisFailure({status,retryAfterSeconds:1}),/다시 시도/);
 assert.match(analysisFailure({status:429,retryAfterSeconds:1}),/1초 후/);
 assert.equal(analysisTime(undefined),'기록 없음');assert.equal(analysisTime('2026-11-09T12:30:00Z'),'2026-11-09 12:30');
});

test('generated summary and guide stay successful when the analysis model is unavailable', () => {
  const generated = {ok: true, made: true, source: 'provider'};
  const outcomes = analysisOutcomes({
    artwork: {...base, summaryStatus: 'suggested', guideStatus: 'suggested', tagStatus: 'confirmed'},
    summary: generated,
    guide: generated,
    tag: {ok: true, made: false, source: 'kept'},
    emotion: {ok: false, made: false, code: 'AI_UNAVAILABLE', error: '분석 모델 연결을 준비 중이에요.'},
  });
  assert.deepEqual(outcomes, [
    {label: '쉬운 요약', status: 'created', text: '제안 생성 완료'},
    {label: '관람가이드', status: 'created', text: '제안 생성 완료'},
    {label: '취향 태그', status: 'kept', text: '기존 확정 유지'},
    {label: '감정 분석', status: 'unavailable', text: '연결 확인 필요 · 분석 모델 연결을 준비 중이에요.'},
  ]);
});

test('kept drafts and actual errors appear only in their own rows', () => {
  const outcomes = analysisOutcomes({
    artwork: base,
    summary: {ok: true, source: 'kept', made: false},
    guide: {ok: false, code: 'PROVIDER_ERROR', error: '응답 형식을 확인해 주세요.', made: false},
    tag: {ok: true, source: 'provider', made: true},
    emotion: {ok: true, source: 'provider', made: true},
  });
  assert.deepEqual(outcomes.map(({status}) => status), ['kept', 'failed', 'created', 'created']);
  assert.equal(outcomes[1].text, '처리 실패 · 응답 형식을 확인해 주세요.');
});

test('legacy responses still identify fallback summaries and confirmed guides', () => {
  const outcomes = analysisOutcomes({
    artwork: base,
    summary: {ok: true, source: 'fallback'},
    guide: {made: false},
    emotion: {ok: true},
  });
  assert.deepEqual(outcomes.map(({status}) => status), ['fallback', 'kept', 'empty', 'created']);
});

test('partial timeout identifies only the items to retry', () => {
  const partial = {
    ...result,
    tag: {ok: false, code: 'AI_TIMEOUT'},
    emotion: {ok: false, code: 'AI_TIMEOUT'},
  };
  assert.deepEqual(failedAnalysisFields(partial), ['tag', 'emotion']);
  assert.equal(analysisOutcomes(partial)[2].text, '분석 응답 시간 초과');
  assert.equal(analysisOutcomes(partial)[0].text, '기존 확정 유지');
});

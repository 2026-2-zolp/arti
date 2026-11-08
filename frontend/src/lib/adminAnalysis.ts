/** 분석 결과를 편집 중인 작품에 합치고 장애 후 재시도 안내를 구성합니다. */
import type {Artwork} from '../types';

type Result = {artwork:Artwork; tag?:{made?:boolean}; emotion:{ok:boolean;made?:boolean}; summary:{ok:boolean;made?:boolean;source?:string}; guide?:{made?:boolean}};
/** 서버가 새로 생성한 필드만 반영하고 요청 중 바뀐 입력과 기존 확정 콘텐츠를 보존합니다. */
export function mergeAnalysis(current:Artwork, started:Artwork, result:Result):Artwork {
  if (current.id !== started.id || current.id!==result.artwork.id || (current.version ?? 0)>(result.artwork.version ?? 0)) return current;
  const next={...current};
  const groups: [boolean|undefined,(keyof Artwork)[]][]=[
    [result.tag?.made ?? result.emotion.made ?? result.emotion.ok,['tagStatus','tagScores']],
    [result.emotion.made ?? result.emotion.ok,['analysis','emotionStatus']],
    [result.summary.made ?? (result.summary.ok && result.summary.source!=='kept'),['summary','summaryKeywords','summaryStatus']],
    [result.guide?.made,['guideIntro','guidedLooking','guidedHints','guideStatus']],
  ];
  for (const [made,fields] of groups) {
    if (!made || fields.some(key=>JSON.stringify(current[key])!==JSON.stringify(started[key]))) continue;
    for (const key of fields) Object.assign(next,{[key]:result.artwork[key]});
  }
  // 더 늦게 저장된 편집 버전은 오래된 분석 응답으로 되돌리지 않습니다.
  if ((current.version ?? 0) <= (result.artwork.version ?? 0)) {
    for (const key of ['updatedAt','version','contentVersion','sourceVersion'] as const) Object.assign(next,{[key]:result.artwork[key]});
  }
  return next;
}

/** 내부 오류 내용을 추가 노출하지 않고 상태별 다음 행동을 안내합니다. */
export function analysisFailure(error:unknown):string {
  const e=error as {status?:number;retryAfterSeconds?:number;message?:string};
  if (e?.status===429) return `다른 분석을 진행 중이거나 요청이 많아요. ${e.retryAfterSeconds ? `${e.retryAfterSeconds}초 후` : '잠시 후'} 다시 시도해 주세요. 입력한 내용은 유지돼요.`;
  if (e?.status===503) return '분석 서비스가 준비 중이거나 연결되지 않았어요. 잠시 후 다시 시도해 주세요. 입력한 내용은 유지돼요.';
  if (e?.status===504) return '분석 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요. 입력한 내용은 유지돼요.';
  if (e?.status===502) return '분석 서비스 응답이 중단되었거나 올바르지 않아요. 복구 후 다시 시도해 주세요. 입력한 내용은 유지돼요.';
  return e?.message || 'AI 분석에 실패했어요. 입력한 내용은 유지돼요.';
}

/** 이전 자료에 분석 시각이 없어도 화면을 렌더링합니다. */
export function analysisTime(value:unknown):string {
  return typeof value==='string' && value ? value.slice(0,16).replace('T',' ') : '기록 없음';
}

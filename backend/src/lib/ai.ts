/**
 * Claude API를 쓰는 AI 기능 (감정 분석은 별도 Python 서버 — emotionClient.ts)
 *
 * 1) 해설 요약       — A-04: 미술관 공식 해설 → 초보자용 3~4문장 요약 + 키워드 (관리자 확인 후 확정)
 * 2) AI 맞춤 설명    — U-10: 사용자 취향 + 작품 감정 분석 결과를 연결한 감상 가이드
 * 3) AI 자유 질문    — U-11: 작품 자료만 근거로 답변
 * 4) 영수증 취향 해석 — U-12: 오늘 본 작품의 감정 분석 결과 + 반응으로 관람 취향 해석
 *
 * - ANTHROPIC_API_KEY가 있으면 Claude, 없거나 실패하면 규칙 기반 결과로 대체한다
 *   (키 없이도 서비스 전체가 동작하고, 발표 중 네트워크 문제가 생겨도 화면이 멈추지 않도록).
 * - 모든 프롬프트는 "미술관이 등록한 자료만 근거로, 없는 사실을 지어내지 말 것"을 지시한다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { config } from '../config.js';
import { TASTE_LABEL } from '../seed.js';
import type { Artwork, EmotionScores, Reaction, TasteTag } from '../types.js';
import { emotionLabel, EMOTION_KEYS, topEmotions } from './emotion.js';
import { josa } from './josa.js';

let client: Anthropic | null = null;
const claude = () => (client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 }));

/** Claude 호출 공통 옵션: 짧은 작업이라 낮은 effort, 안전 분류기 거절 시 서버 측 권장 모델로 재시도 */
const COMMON: { max_tokens: number; betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = {
  max_tokens: 4000,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
};

const DOCENT_RULES = `- <artwork> 태그 안의 작품 자료(해설, 관찰 포인트, 출처, 감정 분석)에 있는 사실만 근거로 쓰세요. 자료에 없는 연도, 일화, 해석을 사실처럼 지어내지 마세요.
- 전문 용어는 쉬운 말로 풀어 주고, 실제 작품의 어디를 보면 되는지 구체적으로 안내하세요.
- 한국어 존댓말(해요체)로 쓰고, 마크다운 제목이나 표는 쓰지 마세요.`;

const SYSTEM_PROMPT = `당신은 미술관 관람 서비스 ARTI의 도슨트입니다. 사용자는 미술 감상 초보자이며, 지금 실제 작품 앞에 서서 스마트폰으로 질문하고 있습니다.

답변 원칙:
${DOCENT_RULES}
- 자료로 답할 수 없는 질문이면 "등록된 자료에는 그 내용이 없어요"라고 솔직히 말한 뒤, 작품을 직접 관찰해서 스스로 답을 찾을 수 있는 방법을 한 가지 제안하세요.
- 3~5문장 이내로 답하세요.
- 작품과 무관한 요청에는 짧게 거절하고 작품 감상으로 대화를 돌려 주세요.`;

const emotionText = (s: EmotionScores) =>
  EMOTION_KEYS.map((k) => `${emotionLabel(k)} ${s[k].toFixed(2)}`).join(', ');

function artworkContext(w: Artwork): string {
  const emo = w.emotionStatus === 'confirmed' && w.analysis ? w.analysis.emotions : null;
  return `<artwork>
제목: ${w.title}
작가: ${w.artist}
제작연도: ${w.year}
특성 태그: ${w.tags.map((t) => TASTE_LABEL[t]).join(', ') || '없음'}
해설: ${w.description}
관찰 포인트:
${w.guidedLooking.map((g) => `- ${g}`).join('\n')}
출처: ${w.source || '검수 중인 자료'}${emo ? `\n감정 분석(AI, 관리자 확인, 0~1 상대값): ${emotionText(emo)}` : ''}
</artwork>`;
}

function logClaudeError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) console.error('[ai] ANTHROPIC_API_KEY가 올바르지 않습니다.');
  else if (err instanceof Anthropic.RateLimitError) console.warn('[ai] 요청 한도 초과 — 규칙 기반 결과로 대체');
  else if (err instanceof Anthropic.APIError) console.warn(`[ai] Claude API 오류 ${err.status} — 규칙 기반 결과로 대체`);
  else console.warn('[ai] Claude 호출 실패 — 규칙 기반 결과로 대체', err);
}

/** 자유 형식 텍스트 답변. 실패·거절 시 null → 호출부에서 규칙 기반 결과 사용 */
async function askClaude(system: string, userContent: string): Promise<string | null> {
  if (!config.ai.enabled) return null;
  try {
    const res = await claude().beta.messages.create({
      ...COMMON,
      model: config.ai.model,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: userContent }],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return text || null;
  } catch (err) {
    logClaudeError(err);
    return null;
  }
}

// ───────────────────────── 1) 해설 요약 (A-04) ─────────────────────────
/** Claude가 반드시 이 JSON 형식으로만 답하게 한다 (Structured Outputs) */
const SummarySchema = z.object({
  summary: z.string().describe('초보자용 요약 3~4문장'),
  keywords: z.array(z.string()).describe('작품을 대표하는 짧은 키워드 3개'),
});

export interface SummaryResult {
  summary: string;
  keywords: string[];
  source: 'claude' | 'fallback';
}

export async function summarizeDescription(w: Artwork): Promise<SummaryResult> {
  if (config.ai.enabled && w.description.trim()) {
    try {
      const res = await claude().beta.messages.parse({
        ...COMMON,
        model: config.ai.model,
        output_config: { effort: 'low', format: betaZodOutputFormat(SummarySchema) },
        system: `당신은 미술관 해설을 미술 감상 초보자용으로 다듬는 편집자입니다.
${DOCENT_RULES}
- 요약은 3~4문장, 200자 안팎으로 쓰세요. 원문에 없는 정보는 절대 추가하지 마세요.
- 키워드는 원문에 근거한 2~8글자 명사구 3개로 쓰세요.`,
        messages: [{ role: 'user', content: `${artworkContext(w)}\n\n위 작품의 해설을 요약해 주세요.` }],
      });
      const out = res.stop_reason === 'refusal' ? null : res.parsed_output;
      if (out?.summary.trim()) {
        return { summary: out.summary.trim(), keywords: out.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 3), source: 'claude' };
      }
    } catch (err) {
      logClaudeError(err);
    }
  }
  // 대체: 원문 앞 2문장 + 취향 태그
  const sentences = w.description.split(/(?<=[.!?。])\s+/).filter(Boolean);
  return {
    summary: sentences.slice(0, 2).join(' '),
    keywords: w.tags.map((t) => TASTE_LABEL[t]).slice(0, 3),
    source: 'fallback',
  };
}

// ───────────────────────── 2) AI 맞춤 설명 (U-10) ─────────────────────────
/** 같은 작품·취향 조합은 결과를 재사용 (작품 화면을 열 때마다 API 비용이 나가지 않도록) */
const explanationCache = new Map<string, string>();

export async function personalizedExplanation(w: Artwork, tastes: TasteTag[]): Promise<string> {
  const matched = w.tags.filter((t) => tastes.includes(t));
  const key = `${w.id}|${w.updatedAt}|${w.emotionStatus}|${[...tastes].sort().join(',')}`;
  const cached = explanationCache.get(key);
  if (cached) return cached;

  const tasteText = tastes.length ? tastes.map((t) => TASTE_LABEL[t]).join(', ') : '아직 파악되지 않음';
  const ai = await askClaude(
    `당신은 미술관 관람 서비스 ARTI의 도슨트입니다.\n${DOCENT_RULES}\n- 4~6문장으로 쓰세요.`,
    `${artworkContext(w)}\n\n이 관람객이 좋아하는 취향: ${tasteText}\n` +
      `이 작품에서 겹치는 취향: ${matched.map((t) => TASTE_LABEL[t]).join(', ') || '없음'}\n\n` +
      '이 관람객의 취향(그리고 감정 분석이 있다면 작품의 감정)과 연결해서, 지금 작품 앞에서 무엇을 어떤 순서로 보면 좋을지 맞춤 감상 가이드를 써 주세요. ' +
      '첫 문장은 취향과 작품을 연결하는 말로 시작하고, 마지막 문장은 관찰을 유도하는 질문으로 끝내세요.',
  );
  const text = ai ?? ruleBasedExplanation(w, matched);
  if (ai) {
    if (explanationCache.size > 500) explanationCache.clear();
    explanationCache.set(key, text);
  }
  return text;
}

const TIPS: Record<TasteTag, string> = {
  landscape: '그림 속 가장 먼 곳부터 가까운 곳까지 시선을 옮겨 보세요. 하늘과 땅이 만나는 선이 공간의 깊이를 만들어요.',
  people: '인물의 시선과 손이 어디를 향하는지 따라가 보세요. 작가가 보여 주고 싶은 이야기가 그 끝에 있을 때가 많아요.',
  abstract: '무엇을 그렸는지보다 형태들이 서로 어떻게 균형을 맞추는지에 집중해 보세요.',
  light: '빛이 어디서 들어와 어디에 머무는지 찾아보세요. 가장 밝은 점이 작품의 중심일 때가 많아요.',
  vivid: '색이 서로 부딪히는 경계를 먼저 찾아보세요. 작가가 어떤 색을 나란히 놓았는지 보면 화면의 에너지가 어디서 오는지 알 수 있어요.',
  cool: '푸른빛이 가장 짙은 곳과 옅은 곳을 찾아보세요. 차가운 색이 만드는 거리감과 고요함을 느낄 수 있어요.',
  warm: '붉고 노란 색이 모인 곳을 찾아보세요. 따뜻한 색은 앞으로 다가오는 듯 보여 시선을 끌어당겨요.',
  soft: '색이 다음 색으로 넘어가는 부분을 천천히 따라가 보세요. 경계가 흐릿할수록 부드러운 인상이 커져요.',
};

function ruleBasedExplanation(w: Artwork, matched: TasteTag[]): string {
  const lead = matched.length
    ? `${matched.map((t) => josa(`'${TASTE_LABEL[t]}'`, '와', '과')).join(' ')} 끌리는 분이라면,`
    : '평소 취향과는 조금 다른 작품이지만,';
  const focus = matched[0] ?? w.tags[0];
  const emo =
    w.emotionStatus === 'confirmed' && w.analysis
      ? `\n\n이 작품에서는 특히 '${topEmotions(w.analysis.emotions).map(emotionLabel).join("', '")}'의 분위기가 느껴져요.`
      : '';
  return `${lead} 「${w.title}」에서는 이런 점을 눈여겨보세요.\n\n${focus ? TIPS[focus] : ''}${emo}\n\n${w.guidedLooking[0] ?? ''}`;
}

// ───────────────────────── 3) AI 자유 질문 (U-11) ─────────────────────────
export async function answerQuestion(w: Artwork, question: string): Promise<string> {
  const answer =
    (await askClaude(SYSTEM_PROMPT, `${artworkContext(w)}\n\n관람객 질문: ${question}`)) ?? ruleBasedAnswer(w, question);
  return `${answer}\n\n출처: ${w.source || '검수 중인 자료'}`;
}

function ruleBasedAnswer(w: Artwork, question: string): string {
  const q = question.replace(/\s/g, '');
  if (/작가|누가|화가/.test(q)) return `「${w.title}」은(는) ${w.artist}의 작품이고, ${w.year}에 제작되었어요.`;
  if (/언제|연도|년/.test(q)) return `제작 시기는 ${w.year}입니다.`;
  if (/감정|느낌|분위기|기분/.test(q) && w.emotionStatus === 'confirmed' && w.analysis)
    return `AI 감정 분석으로는 '${topEmotions(w.analysis.emotions).map(emotionLabel).join("', '")}'의 분위기가 가장 강하게 나타나요. 작품 앞에서 그 느낌을 만드는 색과 형태를 찾아보세요.`;
  if (/색|컬러/.test(q)) {
    const s = w.description.split(/(?<=\.)\s/).find((x) => x.includes('색'));
    return s
      ? `${s} 작품 앞에서 가장 밝은 색과 가장 어두운 색을 각각 찾아보면 차이가 더 잘 보여요.`
      : '등록된 자료에는 색에 대한 설명이 따로 없어요. 화면에서 가장 넓게 쓰인 색을 먼저 찾아보세요.';
  }
  if (/어디|먼저|보|관찰|포인트/.test(q))
    return `처음 보신다면 이렇게 시작해 보세요.\n• ${w.guidedLooking.join('\n• ')}`;
  if (/의미|왜|이유|뜻/.test(q)) return w.description;
  return `${w.description.split('. ')[0]}. 더 궁금한 점이 있다면 작가, 색, 관찰 포인트에 대해 물어보세요.`;
}

// ───────────────────────── 4) 영수증 취향 해석 (U-12) ─────────────────────────
export interface VisitForInterpretation {
  artworks: Artwork[]; // 오늘 본 작품 (본 순서)
  reactions: Record<string, Reaction>;
  dwell: Record<string, number>; // 작품별 감상 시간(초)
  profile: EmotionScores | null; // 오늘 관람의 감정 프로필
}

export async function interpretVisit(v: VisitForInterpretation): Promise<{ text: string; source: 'claude' | 'fallback' }> {
  const lines = v.artworks.map((w) => {
    const r = v.reactions[w.id] === 'like' ? '👍' : v.reactions[w.id] === 'dislike' ? '👎' : '반응 없음';
    const emo = w.emotionStatus === 'confirmed' && w.analysis ? emotionText(w.analysis.emotions) : '감정 분석 없음';
    return `- 「${w.title}」(${w.artist}) · ${r} · 감상 ${Math.round(v.dwell[w.id] ?? 0)}초 · ${emo}`;
  });
  const ai = await askClaude(
    `당신은 미술관 관람 서비스 ARTI가 관람을 마친 사용자에게 건네는 "아트 영수증"의 한 줄 해설을 씁니다.
- 아래 관람 기록(작품, 반응, 감상 시간, AI 감정 분석 점수)에 있는 내용만 근거로 쓰세요. 작품에 대한 새로운 사실을 지어내지 마세요.
- 2~3문장, 해요체로, 사용자가 어떤 분위기의 작품에 끌렸는지와 다음 관람에서 시도해 볼 만한 감상 방법을 따뜻하게 알려 주세요.
- 마크다운, 이모지, 목록을 쓰지 마세요.`,
    `오늘 본 작품:\n${lines.join('\n')}\n\n오늘 관람의 감정 프로필: ${v.profile ? emotionText(v.profile) : '분석된 작품 없음'}`,
  );
  if (ai) return { text: ai, source: 'claude' };

  const liked = v.artworks.filter((w) => v.reactions[w.id] === 'like').map((w) => `「${w.title}」`);
  const longest = [...v.artworks].sort((a, b) => (v.dwell[b.id] ?? 0) - (v.dwell[a.id] ?? 0))[0];
  const parts: string[] = [];
  if (v.profile) {
    const top = topEmotions(v.profile).map((k) => `'${emotionLabel(k)}'`);
    parts.push(`오늘은 ${top.join('과 ')}의 분위기가 느껴지는 작품에 마음이 많이 갔어요.`);
  }
  if (liked.length) parts.push(`특히 ${liked.join(', ')}에 좋아요를 남겼어요.`);
  else if (longest) parts.push(`「${longest.title}」 앞에서 가장 오래 머물렀어요.`);
  parts.push('다음 관람에서는 평소와 다른 분위기의 작품도 한 점 골라 천천히 비교해 보세요.');
  return { text: parts.join(' '), source: 'fallback' };
}

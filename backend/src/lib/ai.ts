/**
 * AI 기능: U-10 "AI 맞춤 설명", U-11 "AI 자유 질문"
 *
 * - ANTHROPIC_API_KEY가 설정돼 있으면 Claude API로 답변을 만든다.
 * - 키가 없거나 호출이 실패하면 규칙 기반 답변(프론트 목업과 같은 로직)으로 대신한다.
 *   → 키 없이도 서비스 전체가 동작하고, 발표 중 네트워크 문제가 생겨도 화면이 멈추지 않는다.
 *
 * 설계 메모(U-11): "AI 답변은 작품 관련 검증 자료를 근거로 제공" → 등록된 작품 해설·Guided Looking·출처만
 * 프롬프트에 넣고, 그 범위 밖의 내용은 지어내지 말라고 지시한다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { TASTE_LABEL } from '../seed.js';
import type { Artwork, TasteTag } from '../types.js';
import { josa } from './josa.js';

let client: Anthropic | null = null;
const claude = () => (client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 }));

const SYSTEM_PROMPT = `당신은 미술관 관람 서비스 ARTI의 도슨트입니다. 사용자는 미술 감상 초보자이며, 지금 실제 작품 앞에 서서 스마트폰으로 질문하고 있습니다.

답변 원칙:
- <artwork> 태그 안의 작품 자료(해설, 관찰 포인트, 출처)에 있는 사실만 근거로 답하세요. 자료에 없는 연도, 일화, 해석을 사실처럼 지어내지 마세요.
- 자료로 답할 수 없는 질문이면 "등록된 자료에는 그 내용이 없어요"라고 솔직히 말한 뒤, 작품을 직접 관찰해서 스스로 답을 찾을 수 있는 방법을 한 가지 제안하세요.
- 전문 용어는 쉬운 말로 풀어 주고, 실제 작품의 어디를 보면 되는지 구체적으로 안내하세요.
- 한국어 존댓말(해요체)로 3~5문장 이내로 답하세요. 마크다운 제목이나 표는 쓰지 마세요.
- 작품과 무관한 요청에는 짧게 거절하고 작품 감상으로 대화를 돌려 주세요.`;

function artworkContext(w: Artwork): string {
  return `<artwork>
제목: ${w.title}
작가: ${w.artist}
제작연도: ${w.year}
특성 태그: ${w.tags.map((t) => TASTE_LABEL[t]).join(', ') || '없음'}
해설: ${w.description}
관찰 포인트:
${w.guidedLooking.map((g) => `- ${g}`).join('\n')}
출처: ${w.source || '검수 중인 자료'}
</artwork>`;
}

/** Claude 호출. 실패·거절 시 null을 돌려주고 호출부에서 규칙 기반 답변을 쓴다. */
async function askClaude(userContent: string): Promise<string | null> {
  if (!config.ai.enabled) return null;
  try {
    const res = await claude().beta.messages.create({
      model: config.ai.model,
      max_tokens: 4000,
      // 짧은 Q&A이므로 낮은 effort로 응답 속도·비용을 줄인다
      output_config: { effort: 'low' },
      // 안전 분류기가 요청을 거절하면 서버 측에서 권장 모델로 다시 시도
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = res.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();
    return text || null;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.error('[ai] ANTHROPIC_API_KEY가 올바르지 않습니다.');
    else if (err instanceof Anthropic.RateLimitError) console.warn('[ai] 요청 한도 초과 — 규칙 기반 답변으로 대체');
    else if (err instanceof Anthropic.APIError) console.warn(`[ai] Claude API 오류 ${err.status} — 규칙 기반 답변으로 대체`);
    else console.warn('[ai] Claude 호출 실패 — 규칙 기반 답변으로 대체', err);
    return null;
  }
}

// ───────────────────────── U-11 AI 자유 질문 ─────────────────────────
export async function answerQuestion(w: Artwork, question: string): Promise<string> {
  const answer =
    (await askClaude(`${artworkContext(w)}\n\n관람객 질문: ${question}`)) ?? ruleBasedAnswer(w, question);
  return `${answer}\n\n출처: ${w.source || '검수 중인 자료'}`;
}

function ruleBasedAnswer(w: Artwork, question: string): string {
  const q = question.replace(/\s/g, '');
  if (/작가|누가|화가/.test(q)) return `「${w.title}」은(는) ${w.artist}의 작품이고, ${w.year}에 제작되었어요.`;
  if (/언제|연도|년/.test(q)) return `제작 시기는 ${w.year}입니다.`;
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

// ───────────────────────── U-10 AI 맞춤 설명 ─────────────────────────
/** 같은 작품·취향 조합은 결과를 재사용 (작품 화면을 열 때마다 API 비용이 나가지 않도록) */
const explanationCache = new Map<string, string>();

export async function personalizedExplanation(w: Artwork, tastes: TasteTag[]): Promise<string> {
  const matched = w.tags.filter((t) => tastes.includes(t));
  const key = `${w.id}|${w.updatedAt}|${[...tastes].sort().join(',')}`;
  const cached = explanationCache.get(key);
  if (cached) return cached;

  const tasteText = tastes.length ? tastes.map((t) => TASTE_LABEL[t]).join(', ') : '아직 파악되지 않음';
  const ai = await askClaude(
    `${artworkContext(w)}\n\n이 관람객이 좋아하는 취향: ${tasteText}\n` +
      `이 작품에서 겹치는 취향: ${matched.map((t) => TASTE_LABEL[t]).join(', ') || '없음'}\n\n` +
      '이 관람객의 취향과 연결해서, 지금 작품 앞에서 무엇을 어떤 순서로 보면 좋을지 맞춤 감상 가이드를 써 주세요. ' +
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
  vivid: '색이 서로 부딪히는 경계를 먼저 찾아보세요. 작가가 어떤 색을 나란히 놓았는지 보면 화면의 에너지가 어디서 오는지 알 수 있어요.',
  calm: '작품 앞에서 잠시 숨을 고르고 화면의 가장 조용한 부분을 찾아보세요. 여백이 그림의 분위기를 만들어요.',
  abstract: '무엇을 그렸는지보다 형태들이 서로 어떻게 균형을 맞추는지에 집중해 보세요.',
  soft: '색이 다음 색으로 넘어가는 부분을 천천히 따라가 보세요. 경계가 흐릿할수록 부드러운 인상이 커져요.',
  emotion: '이 장면 속 인물이나 풍경이 어떤 기분일지 상상해 보고, 그 감정을 만드는 선과 색을 찾아보세요.',
  light: '빛이 어디서 들어와 어디에 머무는지 찾아보세요. 가장 밝은 점이 작품의 중심일 때가 많아요.',
};

function ruleBasedExplanation(w: Artwork, matched: TasteTag[]): string {
  const lead = matched.length
    ? `${matched.map((t) => josa(`'${TASTE_LABEL[t]}'`, '와', '과')).join(' ')} 끌리는 분이라면,`
    : '평소 취향과는 조금 다른 작품이지만,';
  const focus = matched[0] ?? w.tags[0];
  return `${lead} 「${w.title}」에서는 이런 점을 눈여겨보세요.\n\n${focus ? TIPS[focus] : ''}\n\n${w.guidedLooking[0] ?? ''}`;
}

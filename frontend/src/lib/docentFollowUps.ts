import type { Artwork, ChatMessage } from '../types';

const themes = [
  { pattern: /(?<![\p{L}\p{N}])빛|햇빛|불빛|조명|밝|어둡|어두|그늘|명암/u, question: '방금 본 부분과 주변을 번갈아 보면 밝기는 어떻게 달라 보이나요?' },
  { pattern: /색|노란|노랑|파란|파랑|붉|빨강|흰|하얀|분홍|보라빛|초록|금빛/, question: '방금 본 색을 주변 색과 어떻게 비교해 보면 좋을까요?' },
  { pattern: /형태|모양|윤곽|노란 원|둥글|곡선|직선|경계|가장자리|가는 선|선이|선을|선은/, question: '방금 본 형태의 경계를 눈으로 따라가면 어떻게 이어지나요?' },
  { pattern: /위쪽|아래|하단|상단|왼쪽|오른쪽|중앙|가운데|배치|구도/, question: '방금 본 부분에서 시선을 옮기면 어디에 먼저 눈이 가나요?' },
  { pattern: /두\s*손|양손|한\s*손|손가락|손짓|손을|손은|손이|손의|손에/, question: '방금 본 손에서 눈을 옮기면 다음으로 어디가 눈에 들어오나요?' },
  { pattern: /시선|눈길|(?:바라|내려다)(?:보|봅|본)|아래를 봅|향하고 있|고개를 기울/, question: '방금 본 인물의 시선을 따라가면 어디에 먼저 눈이 가나요?' },
  { pattern: /꽃|백합|장미|꽃잎/, question: '방금 본 꽃을 주변과 나란히 보면 어떤 특징이 더 눈에 들어오나요?' },
  { pattern: /붓질|질감|재질|표면|물감/, question: '방금 본 표면과 그 옆을 비교하면 질감은 어떻게 달라 보이나요?' },
];

const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function docentFollowUps(
  work: Pick<Artwork, 'id' | 'reviewStatus' | 'guideStatus' | 'sourceVersion' | 'guidedLooking' | 'description'>
    & Partial<Pick<Artwork, 'guidedHints'>>,
  history: readonly ChatMessage[],
  guideQuestion?: string,
) {
  const answer = history.at(-1);
  const question = history.at(-2);
  if (work.reviewStatus !== 'approved' || !work.sourceVersion
      || answer?.role !== 'ai' || answer.mode !== 'llm' || question?.role !== 'user' || !answer.sourceRefs?.length
      || answer.sourceRefs.some(ref => ref.artworkId !== work.id || ref.sourceVersion !== work.sourceVersion)) return [];

  const prior = new Set(history.filter(message => message.role === 'user').map(message => normalized(message.text)));
  if (guideQuestion) prior.add(normalized(guideQuestion));
  const guide = work.guideStatus === 'confirmed' ? work.guidedLooking.map((question, index) => ({
    question: question.trim(), evidence: [question, work.guidedHints?.[index]].join(' '),
  })) : [];
  const approvedText = [work.description, ...guide.map(item => item.evidence)].join(' ');
  const answerThemes = themes.filter(({ pattern }) => pattern.test(answer.text) && pattern.test(approvedText));
  const questionThemes = themes.filter(({ pattern }) => pattern.test(question.text));

  const orderedGuide = guide.filter(({ evidence }) => answerThemes.some(({ pattern }) => pattern.test(evidence)))
    .map(({ question, evidence }) => ({
      question, score: 2 * answerThemes.filter(({ pattern }) => pattern.test(evidence)).length
        + questionThemes.filter(({ pattern }) => pattern.test(evidence)).length,
    })).sort((left, right) => right.score - left.score).map(item => item.question);
  const observationPrompts = [...answerThemes]
    .sort((left, right) => Number(questionThemes.includes(right)) - Number(questionThemes.includes(left)))
    .map(theme => theme.question);

  return [...orderedGuide, ...observationPrompts].filter(value => {
    const key = normalized(value);
    if (!key || prior.has(key)) return false;
    prior.add(key);
    return true;
  }).slice(0, 2);
}

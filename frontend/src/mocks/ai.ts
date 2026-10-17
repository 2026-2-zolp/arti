import type { Artwork, TasteOption } from '@/types/domain';

/** AI 응답 임시 생성기 — 실제 서비스에서는 검증된 작품 자료를 근거로 서버에서 생성한다. */

export function mockExplanation(artwork: Artwork, tastes: TasteOption[]) {
  const keywords = tastes.flatMap((t) => t.keywords);
  const intro = keywords.length
    ? `‘${keywords.slice(0, 2).join('’, ‘')}’에 관심이 있는 당신에게 이 작품은 특히 흥미로울 거예요.`
    : '처음 미술관을 찾은 당신에게 이 작품을 쉽게 소개해 드릴게요.';
  const point = artwork.guidedLooking[0] ?? '작품 전체를 천천히 둘러보세요.';
  return `${intro} ${artwork.artist}, 「${artwork.title}」(${artwork.year}). ${artwork.description.split('. ')[0]}. 먼저 ${point} 그다음 가까이 다가가 붓질과 색의 겹침을 살펴보면 화면이 전혀 다르게 느껴집니다.`;
}

export function mockSuggestedQuestions(artwork: Artwork) {
  return [
    `이 작품의 색은 왜 ${artwork.tasteTags.includes('soft-color') ? '부드러운가요' : '강렬한가요'}?`,
    '무엇을 먼저 보면 좋을까요?',
    `${artwork.artist}는 어떤 화가인가요?`,
  ];
}

export function mockAnswer(artwork: Artwork, question: string) {
  const q = question.replace(/\s/g, '');
  if (/색|색감|색채/.test(q)) {
    return `${artwork.artist}는 색을 통해 감정을 전달하려 했습니다. ${artwork.description.split('. ')[1] ?? ''} 실제 작품 앞에서 가장 밝은 색과 가장 어두운 색이 맞닿은 곳을 찾아보세요.`.trim();
  }
  if (/먼저|어디|처음/.test(q)) {
    return `처음에는 한 걸음 떨어져 전체 구도를 보세요. 그다음 ${artwork.guidedLooking[0] ?? '가장 눈에 띄는 부분에 다가가 보세요.'}`;
  }
  if (/소용돌이|붓질|움직/.test(q)) {
    return `${artwork.artist}는 짧고 반복적인 붓질을 이어서 움직임을 만들었습니다. 실제 작품을 보며 붓질 방향을 따라가 보세요.`;
  }
  if (/화가|작가|누구/.test(q)) {
    return `${artwork.artist}는 ${artwork.year}년 무렵 이 작품을 완성했습니다. 작가의 다른 작품과 비교해 보면 이 시기의 특징이 더 잘 보입니다.`;
  }
  return `좋은 질문이에요. 「${artwork.title}」에서는 ${artwork.guidedLooking[1] ?? artwork.guidedLooking[0] ?? '세부를 천천히 살펴보는 것'}이 도움이 됩니다. 작품을 다시 보며 느낀 점을 이어서 물어보세요.`;
}

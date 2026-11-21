import assert from 'node:assert/strict';
import test from 'node:test';
import { docentFollowUps } from '../src/lib/docentFollowUps';
import type { Artwork, ChatMessage } from '../src/types';

const flower = '백합과 다른 꽃의 모양은 어떻게 달라 보이나요?';
const colour = '화면 다른 곳에도 백합과 비슷한 흰색이 보이나요?';
const surface = '붓질의 질감은 어디에서 잘 보이나요?';
const work = {
  id: 'a', reviewStatus: 'approved', guideStatus: 'confirmed', sourceVersion: 2,
  description: '',
  guidedLooking: [surface, flower, colour],
} satisfies Pick<Artwork, 'id' | 'reviewStatus' | 'guideStatus' | 'sourceVersion' | 'guidedLooking' | 'description'>;
const answer: ChatMessage = {
  id: '2', role: 'ai', mode: 'llm', text: '백합은 흰색이고, 붓질의 질감도 보입니다.',
  sourceRefs: [{ artworkId: 'a', kind: 'original', sourceVersion: 2, revision: 2 }],
};
const prompt: ChatMessage = { id: '1', role: 'user', text: '아래쪽 백합의 색은 어떤가요?' };

test('ranks approved observations using the latest answer and question and offers at most two', () => {
  assert.deepEqual(docentFollowUps(work, [prompt, answer]), [colour, flower]);
  assert.deepEqual(docentFollowUps(work, [prompt, answer], colour), [flower, surface]);
  const matchingQuestion = { ...prompt, text: colour.slice(0, -1) };
  assert.deepEqual(docentFollowUps(work, [matchingQuestion, answer]), [flower, surface]);
  assert.deepEqual(docentFollowUps(work, [{ ...prompt, text: '붓질의 질감은 어떻게 보이나요?' }, answer]), [colour, surface]);
});

test('excludes fallback, unconfirmed, stale and other artwork evidence', () => {
  assert.deepEqual(docentFollowUps({ ...work, guideStatus: 'suggested' }, [prompt, answer]), []);
  assert.deepEqual(docentFollowUps({ ...work, sourceVersion: 3 }, [prompt, answer]), []);
  assert.deepEqual(docentFollowUps(work, [prompt, { ...answer, mode: 'fallback' }]), []);
  assert.deepEqual(docentFollowUps(work, [prompt, { ...answer, sourceRefs: [] }]), []);
  const foreign = { artworkId: 'b', kind: 'original' as const, sourceVersion: 2, revision: 2 };
  assert.deepEqual(docentFollowUps(work, [prompt, { ...answer, sourceRefs: [...answer.sourceRefs!, foreign] }]), []);
});

test('uses the latest grounded observation after the approved guide questions have been asked', () => {
  const prior = [colour, flower, surface].flatMap((text, index) => [
    { ...prompt, text, id: `question-${index}` }, { ...answer, id: `answer-${index}` },
  ]);
  const next = docentFollowUps(work, prior);
  assert.equal(next.length, 2);
  assert.match(next[0], /질감/);
  const continued = docentFollowUps(work, [...prior, { ...prompt, text: next[0] }, answer]);
  assert.equal(continued.length, 2);
  assert.ok(!continued.includes(next[0]));
});

test('a work without a confirmed guide can suggest a visible cue supported by the approved explanation', () => {
  const withoutGuide = { ...work, guideStatus: 'suggested' as const, description: '백합은 흰색입니다.' };
  const next = docentFollowUps(withoutGuide, [prompt, answer]);
  assert.equal(next.length, 2);
  assert.ok(next.every(text => ![colour, flower, surface].includes(text) && !text.includes('질감')));
});

test('a grounded answer about clasped hands and gaze provides a way to continue observing', () => {
  const artwork = { ...work, description: '무릎 꿇은 인물은 두 손을 가슴 앞에 모았어요.', guidedLooking: [] };
  const looking = { ...prompt, text: '인물의 시선과 손이 향하는 곳을 볼까요?' };
  const observation = { ...answer, text: '두 손은 가슴 앞에 모여 있으니 시선이 어디를 향하는지 살펴보세요.' };
  assert.equal(docentFollowUps(artwork, [looking, observation]).length, 1);
  assert.deepEqual(docentFollowUps({ ...artwork, description: '가만히 흐르는 강입니다.' }, [looking, observation]), []);
});

test('distinguishes a garment hue from lighting and uses confirmed hints to connect the visible cue', () => {
  const veil = '머리에 드리운 베일은 어느 부분에서 더 잘 보이나요?';
  const faces = '서로 가까이 있는 세 얼굴은 어느 쪽을 향하고 있나요?';
  const artwork = {
    ...work, description: '분홍빛 옷을 입은 마리아가 아기를 안고 아래를 봅니다. 머리와 어깨에 베일이 드리워져 있습니다.',
    guidedLooking: [faces, veil], guidedHints: ['', '머리에서 어깨로 이어지는 가는 선을 따라가 보세요.'],
  };
  const ask = (question: string, response: string, current = artwork) =>
    docentFollowUps(current, [{ ...prompt, text: question }, { ...answer, text: response }]);
  const hues = ask('마리아가 입은 옷은 무슨 색인가요?', '마리아는 분홍빛 옷을 입고 있습니다.');
  assert.ok(hues.includes('방금 본 색을 주변 색과 어떻게 비교해 보면 좋을까요?'));
  assert.ok(hues.every(question => !question.includes('밝기')));
  assert.equal(ask('마리아는 어느 쪽을 보나요?', '마리아는 품에 안은 아기를 내려다봅니다.')[0], faces);
  assert.equal(ask('처음 봤던 부분은요?', '마리아 어깨의 베일 가장자리라고 하셨어요.')[0], veil);
  const lighting = ask('어떤 빛인가요?', '창에서 들어오는 빛이 인물의 얼굴을 밝힙니다.',
    { ...artwork, description: '오른쪽의 창에서 빛이 들어옵니다.' });
  assert.ok(lighting.some(question => question.includes('밝기')));
  assert.deepEqual(ask('언제 그렸나요?', '1580년경의 작품입니다.'), []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { docentHistory } from '../src/lib/docentHistory';
import type { ChatMessage } from '../src/types';

const pair = (n: number, text: string, mode: ChatMessage['mode'] = 'llm'): ChatMessage[] => [
  { id: `q${n}`, role: 'user', text }, { id: `a${n}`, role: 'ai', mode, text: `${n}번 답변` },
];

test('restores the first successful remark after four newer exchanges, only for an earlier reference', () => {
  const first = '제가 처음에는 노란 원을 등불이라고 적었어요.';
  const other = '가느다란 빨간 선을 먼저 따라갔어요.';
  const messages = [...pair(0, '실패했던 질문', 'refusal'), ...pair(1, first), ...pair(2, other),
    ...[3, 4, 5, 6].flatMap(n => pair(n, `${n}번째 관찰`))];
  const referenced = docentHistory(messages, '이 대화를 시작할 때 제가 붙인 말이 뭐였나요?');
  assert.deepEqual(referenced.earlierObservations, [first]);
  assert.equal(referenced.history.length, 8);
  assert.ok(!referenced.history.some(turn => turn.text === first));
  assert.deepEqual(docentHistory(messages, '아까 가느다란 선을 봤던 부분부터 다시 볼까요?').earlierObservations, [other]);
  assert.deepEqual(docentHistory(messages, '어느 쪽이 더 밝나요?').earlierObservations, []);
  assert.deepEqual(docentHistory(messages, '처음 보는 작품인데 누가 그렸어요?').earlierObservations, []);
});

test('excludes refusal and prior-visit replies and deduplicates remarks still in the recent window', () => {
  const line = '노란 원을 등불이라고 적었어요.';
  const personal = pair(1, '다른 전시의 주제');
  personal[1].usedPreviousVisitMemory = true;
  const messages = [...personal, ...pair(2, line), ...pair(3, line), ...[4, 5, 6].flatMap(n => pair(n, `${n}번`))];
  const result = docentHistory(messages, '첫 관찰은 뭐였나요?');
  assert.deepEqual(result.earlierObservations, []);
  assert.ok(!result.history.some(turn => turn.text === personal[0].text));
});

test('reads natural first-person references and short artwork terms without retrieving unrelated remarks', () => {
  const first = '마리아 어깨의 베일이 먼저 눈에 들어왔어요.';
  const second = '분홍빛 옷의 색이 인상적이었어요.';
  const messages = [...pair(1, first), ...pair(2, second),
    ...[3, 4, 5, 6].flatMap(n => pair(n, `${n}번째 질문`))];
  for (const question of [
    '아까 제가 먼저 눈여겨본 부분이 어디였죠?',
    '처음에 제가 뭐라고 했나요?',
    '아까 베일 얘기할 때 제가 어디를 먼저 봤다고 했죠?',
  ]) {
    const result = docentHistory(messages, question);
    assert.deepEqual(result.earlierObservations, [first]);
    assert.ok(!result.history.some(turn => turn.text === first));
  }
  assert.deepEqual(docentHistory(messages, '아까 백합 얘기했던 부분은요?').earlierObservations, []);
  assert.deepEqual(docentHistory(messages, '이 작품을 처음 보는 사람은 어디부터 보면 좋을까요?').earlierObservations, []);
  assert.deepEqual(docentHistory(messages, '처음에 제가 어디를 먼저 보면 좋을까요?').earlierObservations, []);
});

test('uses the visible conversation order for elliptical references and does not shift past guidance', () => {
  const first = '마리아 어깨의 베일 가장자리를 봤어요.';
  const second = '오른쪽 인물의 고개가 눈에 띄었어요.';
  const third = '세 얼굴이 가까이 모여 보여요.';
  const messages = [...pair(1, first), ...pair(2, second), ...pair(3, third),
    ...[4, 5, 6].flatMap(n => pair(n, `${n}번째 질문`))];
  const initial = docentHistory(messages, '맨 처음 거요. 어디였죠?');
  assert.deepEqual(initial.earlierObservations, [first]);
  assert.equal(initial.reference, 'dialogue_order');
  assert.equal(initial.history.length, 8);
  assert.ok(!initial.history.some(turn => turn.text === first));
  assert.deepEqual(docentHistory(messages, '두 번째 거요. 어느 쪽이었죠?').earlierObservations, [second]);
  assert.deepEqual(docentHistory(messages, '맨 처음이요. 어디였죠?').earlierObservations, [first]);
  assert.deepEqual(docentHistory(messages, '3번째 거요').earlierObservations, [third]);
  for (const question of ['그때 그거요. 뭐였죠?', '그 색은 어디에 보여요?', '두 번째 작품은 어디에 있어요?']) {
    assert.deepEqual(docentHistory(messages, question).earlierObservations, []);
  }
  const withGuidance = [...pair(0, '어느 작품인가요?', 'refusal'), ...messages];
  const unresolved = docentHistory(withGuidance, '맨 처음 거요');
  assert.deepEqual(unresolved.earlierObservations, []);
  assert.equal(unresolved.reference, 'dialogue_order');
  assert.deepEqual(docentHistory(withGuidance, '두 번째 거요').earlierObservations, [first]);
});

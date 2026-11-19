import assert from 'node:assert/strict';
import test from 'node:test';
import { koreanSpeechParts, koreanVoice } from '../src/lib/koreanSpeech';

function voice(lang: string, localService = false) {
  return { lang, localService } as SpeechSynthesisVoice;
}

test('chooses an installed Korean voice and never substitutes a non-Korean default', () => {
  const english = voice('en-US', true);
  const genericKorean = voice('ko', true);
  const localKorean = voice('ko_KR', true);
  const remoteKorean = voice('ko-KR');
  assert.equal(koreanVoice([english, remoteKorean, genericKorean, localKorean]), localKorean);
  assert.equal(koreanVoice([english, remoteKorean, genericKorean]), genericKorean);
  assert.equal(koreanVoice([english, remoteKorean]), remoteKorean);
  assert.equal(koreanVoice([english]), undefined);
  assert.equal(koreanVoice([]), undefined);
});

test('keeps Korean caption pauses and reads dates and dimensions without splitting decimals', () => {
  assert.deepEqual(koreanSpeechParts('성가족.\n1689–1690년의 작품입니다. 106×87.6 cm\n\n밝은 빛이 보여요.'), [
    '성가족.',
    '1689에서 1690년의 작품입니다.',
    '106 곱하기 87.6 센티미터',
    '밝은 빛이 보여요.',
  ]);
  const caption = Array(120).fill('작품을 관찰해요').join(' ');
  const parts = koreanSpeechParts(caption);
  assert(parts.length > 1);
  assert(parts.every(part => part.length <= 180));
  assert.equal(parts.join(' '), caption);
});

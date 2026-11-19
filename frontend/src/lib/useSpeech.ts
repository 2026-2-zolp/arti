/**
 * 음성 설명(TTS) 훅 — 브라우저 내장 Web Speech API(speechSynthesis) 사용.
 * 지원하지 않는 브라우저에서는 supported=false 를 돌려줘 버튼을 비활성화한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { koreanSpeechParts, koreanVoice } from './koreanSpeech';

export function useSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (!supported) return;
    active.current = null;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setError('');
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      stop();
      const engine = window.speechSynthesis;
      const voices = engine.getVoices();
      const voice = koreanVoice(voices);
      if (!voice) {
        setError(voices.length
          ? '사용할 수 있는 한국어 음성이 없어요. 기기 설정에서 한국어 음성을 추가해 주세요.'
          : '음성 목록을 불러오지 못했어요. 잠시 후 다시 눌러 주세요.');
        return;
      }
      const parts = koreanSpeechParts(text);
      if (!parts.length) return;

      const playPart = (index: number) => {
        const utterance = new window.SpeechSynthesisUtterance(parts[index]);
        utterance.voice = voice;
        utterance.lang = voice.lang.replaceAll('_', '-');
        utterance.rate = 0.9;
        utterance.onend = () => {
          if (active.current !== utterance) return;
          if (index + 1 < parts.length) playPart(index + 1);
          else {
            active.current = null;
            setSpeaking(false);
          }
        };
        utterance.onerror = () => {
          if (active.current !== utterance) return;
          active.current = null;
          setSpeaking(false);
          setError('한국어 음성을 재생하지 못했어요. 기기의 음성 설정을 확인하거나 다시 시도해 주세요.');
        };
        active.current = utterance;
        engine.speak(utterance);
      };
      setSpeaking(true);
      playPart(0);
    },
    [stop, supported],
  );

  useEffect(() => {
    if (!supported) return;
    // Some browsers start loading voices only after the first getVoices call.
    window.speechSynthesis.getVoices();
    return stop;
  }, [stop, supported]);

  return { supported, speaking, error, speak, stop };
}

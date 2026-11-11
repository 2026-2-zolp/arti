/**
 * 음성 설명(TTS) 훅 — 브라우저 내장 Web Speech API(speechSynthesis) 사용.
 * 지원하지 않는 브라우저에서는 supported=false 를 돌려줘 버튼을 비활성화한다.
 */
import { useCallback, useEffect, useState } from 'react';

export function useSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.rate = 1;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    },
    [supported],
  );

  // 화면을 벗어나면 재생 중지
  useEffect(() => stop, [stop]);

  return { supported, speaking, speak, stop };
}

/**
 * 녹음된 음성을 재생하거나 브라우저 내장 음성으로 읽습니다.
 * supported는 브라우저 즉석 낭독을 쓸 수 있는지 나타냅니다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { koreanSpeechParts, koreanVoice } from './koreanSpeech';

type ClipLoader = (signal: AbortSignal) => Promise<Blob>;
type PreparedClip = { id: string; controller: AbortController; result: Promise<Blob> };

export function useSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const active = useRef<SpeechSynthesisUtterance | HTMLAudioElement | null>(null);
  const loading = useRef<AbortController | null>(null);
  const clips = useRef(new Map<string, string>());
  const prepared = useRef<PreparedClip | null>(null);

  const cancelPrepared = useCallback(() => {
    prepared.current?.controller.abort();
    prepared.current = null;
  }, []);

  const prepare = useCallback((id: string, loadClip: ClipLoader) => {
    if (document.hidden || clips.current.has(id) || prepared.current?.id === id) return;
    cancelPrepared();
    const controller = new AbortController();
    const job = { id, controller, result: loadClip(controller.signal) };
    prepared.current = job;
    void job.result.catch(() => {
      if (prepared.current === job) prepared.current = null;
    });
  }, [cancelPrepared]);

  const clearClips = useCallback(() => {
    cancelPrepared();
    clips.current.forEach(url => URL.revokeObjectURL(url));
    clips.current.clear();
  }, [cancelPrepared]);

  const stop = useCallback(() => {
    loading.current?.abort();
    loading.current = null;
    const previous = active.current;
    active.current = null;
    if (previous instanceof HTMLAudioElement) previous.pause();
    else if (previous && supported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setPreparing(false);
    setActiveId(undefined);
    setError('');
  }, [supported]);

  const speak = useCallback(
    (text: string, clip?: string, id?: string, loadClip?: ClipLoader, onStarted?: () => void) => {
      stop();
      const finish = (item: NonNullable<typeof active.current>, failed = false) => {
        if (active.current !== item) return;
        active.current = null;
        setSpeaking(false);
        setActiveId(undefined);
        if (failed) setError('한국어 음성을 재생하지 못했어요. 다시 시도해 주세요.');
      };
      const play = (url: string) => {
        const audio = new Audio(url);
        if (onStarted) audio.addEventListener('playing', () => {
          if (active.current === audio) onStarted();
        }, { once: true });
        audio.onended = () => finish(audio);
        audio.onerror = () => finish(audio, true);
        active.current = audio;
        setActiveId(id);
        setSpeaking(true);
        void audio.play().catch((error: unknown) => {
          if (active.current !== audio) return;
          if (error instanceof DOMException && error.name === 'NotAllowedError' && id && clips.current.has(id)) {
            finish(audio);
            setError('음성이 준비됐어요. 듣기를 다시 눌러 주세요.');
          } else finish(audio, true);
        });
      };
      const cached = clip ?? (id ? clips.current.get(id) : undefined);
      if (cached) {
        play(cached);
        return;
      }
      if (loadClip && id) {
        const job = prepared.current?.id === id ? prepared.current : null;
        if (job) prepared.current = null;
        const controller = job?.controller ?? new AbortController();
        loading.current = controller;
        setPreparing(true);
        setActiveId(id);
        void (job?.result ?? loadClip(controller.signal)).then(blob => {
          if (loading.current !== controller) return;
          const url = URL.createObjectURL(blob);
          clips.current.set(id, url);
          if (clips.current.size > 4) {
            const oldest = clips.current.entries().next().value;
            if (oldest) {
              URL.revokeObjectURL(oldest[1]);
              clips.current.delete(oldest[0]);
            }
          }
          loading.current = null;
          setPreparing(false);
          play(url);
        }).catch((error: unknown) => {
          if (loading.current !== controller) return;
          loading.current = null;
          setPreparing(false);
          setActiveId(undefined);
          setError(error instanceof Error ? error.message : '답변 음성을 만들지 못했어요. 다시 눌러 주세요.');
        });
        return;
      }
      if (!supported) return;
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
        if (index === 0 && onStarted) utterance.onstart = () => {
          if (active.current === utterance) onStarted();
        };
        utterance.onend = () => {
          if (active.current !== utterance) return;
          if (index + 1 < parts.length) playPart(index + 1);
          else finish(utterance);
        };
        utterance.onerror = () => finish(utterance, true);
        active.current = utterance;
        engine.speak(utterance);
      };
      setActiveId(id);
      setSpeaking(true);
      playPart(0);
    },
    [stop, supported],
  );

  useEffect(() => {
    // Some browsers start loading voices only after the first getVoices call.
    if (supported) window.speechSynthesis.getVoices();
    const stopIfHidden = () => {
      if (document.hidden) {
        stop();
        cancelPrepared();
      }
    };
    document.addEventListener('visibilitychange', stopIfHidden);
    return () => {
      document.removeEventListener('visibilitychange', stopIfHidden);
      stop();
      clearClips();
    };
  }, [cancelPrepared, clearClips, stop, supported]);

  return { supported, speaking, preparing, activeId, error, speak, stop, clearClips, prepare, cancelPrepared };
}

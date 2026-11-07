import { useEffect, useState } from 'react';
import { fetchProtectedImage, isProtectedImageUrl } from '../api/client';

/** Resolve a private admin image into a short-lived browser object URL. */
export function useProtectedImage(url: string | undefined) {
  const [resolved, setResolved] = useState<{ url: string; src?: string; failed: boolean } | null>(null);
  const protectedUrl = url !== undefined && isProtectedImageUrl(url);
  useEffect(() => {
    if (!url || !protectedUrl) return;
    setResolved(null);
    const controller = new AbortController();
    let objectUrl: string | undefined;
    fetchProtectedImage(url, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved({ url, src: objectUrl, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolved({ url, failed: true });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, protectedUrl]);
  return protectedUrl
    ? resolved?.url === url ? { src: resolved.src, failed: resolved.failed } : { src: undefined, failed: false }
    : { src: url, failed: false };
}

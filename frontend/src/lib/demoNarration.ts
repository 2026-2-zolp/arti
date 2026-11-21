import type { Artwork } from '../types';
import { useAsync } from './useAsync';

const folder = '/test-setup/narration/';
const reviewFolder = `${folder}review/`;
type NarrationEntry = { text: string; clip: string; reviewed?: true };
type Narration = {
  contentVersion: number;
  openingQuestion?: string;
  original?: NarrationEntry;
  guide?: NarrationEntry;
  answers: NarrationEntry[];
};

const validClip = (item: { text?: unknown; clip?: unknown } | null) =>
  typeof item?.text === 'string' && typeof item.clip === 'string' && /^[a-z0-9-]+\.mp3$/.test(item.clip);

export function narrationClip(item: NarrationEntry | undefined) {
  return item && validClip(item) ? (item.reviewed ? reviewFolder : folder) + item.clip : undefined;
}

function reviewedNarration(value: unknown, work: Artwork): Narration | null {
  if (!value || typeof value !== 'object') return null;
  const { artworkId, exhibitionId, contentVersion, sourceVersion, guideRevision, guide } = value as Record<string, unknown>;
  if (artworkId !== work.id || exhibitionId !== work.exhibitionId || typeof contentVersion !== 'number' || contentVersion !== work.contentVersion
    || sourceVersion !== work.sourceVersion || guideRevision !== work.guideRevision
    || !Number.isSafeInteger(contentVersion) || !Number.isSafeInteger(sourceVersion) || !Number.isSafeInteger(guideRevision)
    || !guide || typeof guide !== 'object') return null;
  const { text, clip } = guide as Record<string, unknown>;
  if (typeof text !== 'string' || typeof clip !== 'string' || !validClip({text, clip})) return null;
  return {contentVersion, guide: {text, clip, reviewed: true}, answers: []};
}

export function useDemoNarration(work: Artwork | null | undefined) {
  const enabled = import.meta.env.VITE_ARTI_SYNTHETIC_NARRATION === '1'
    && work?.id === 'fixture-art03' && work.exhibitionId === 'fixture-ex01' && work.reviewStatus === 'approved';
  const reviewExhibition = import.meta.env.VITE_ARTI_REVIEW_NARRATION_EXHIBITION;
  const reviewed = !!reviewExhibition && !!work && work.exhibitionId === reviewExhibition
    && work.reviewStatus === 'approved' && work.guideStatus === 'confirmed';
  const path = enabled ? folder : reviewed ? reviewFolder : undefined;
  const version = work?.contentVersion;
  const { data } = useAsync(async () => {
    if (!path) return null;
    const response = await fetch(path + 'manifest.json', { cache: 'no-cache' });
    if (!response.ok) return null;
    return {path, manifest: await response.json()};
  }, [path]);
  if (!data || data.path !== path) return undefined;
  if (reviewed && work) return reviewedNarration(data.manifest?.artworks?.[work.id], work) ?? undefined;
  const value = data.manifest;
  const legacy: Narration | undefined = enabled && Number.isSafeInteger(value?.contentVersion) && typeof value.openingQuestion === 'string'
      && validClip(value.original) && (value.guide === undefined || validClip(value.guide))
      && Array.isArray(value.answers) && value.answers.every(validClip) ? value : undefined;
  return legacy?.contentVersion === version ? legacy : undefined;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { tastesFromPicks } from '../src/lib/tasteFromPicks';
import type { TasteTag } from '../src/types';

function suggest(...pickedTags: TasteTag[][]) {
  const works = pickedTags.map((tags, index) => ({ id: String(index), tags }));
  return tastesFromPicks(works, works.map(work => work.id));
}

test('only the highest-frequency tag is preselected and other picked tags remain available', () => {
  assert.deepEqual(suggest(['warm'], ['warm', 'landscape'], ['light']), {
    options: ['warm', 'landscape', 'light'], defaultTags: ['warm'],
  });
});

test('preselects both leaders when exactly two tags tie for first', () => {
  assert.deepEqual(suggest(['light', 'warm'], ['warm', 'people'], ['light']), {
    options: ['light', 'warm', 'people'], defaultTags: ['light', 'warm'],
  });
});

test('all eight picked tags remain available when a broad tie leaves no preselection', () => {
  const tags: TasteTag[] = ['landscape', 'people', 'abstract', 'light', 'vivid', 'cool', 'warm', 'soft'];
  const { options, defaultTags } = suggest(tags.slice(0, 2), tags.slice(2, 4), tags.slice(4, 6), tags.slice(6));
  assert.deepEqual(new Set(options), new Set(tags));
  assert.deepEqual(defaultTags, []);
});

test('no tags are suggested without tagged picks', () => {
  assert.deepEqual(suggest([]), { options: [], defaultTags: [] });
});

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

test('a broad tie suggests two leaders in fixed display order and keeps all tags available', () => {
  const picks: TasteTag[][] = [['warm', 'cool'], ['landscape', 'light'], ['people', 'soft'], ['abstract', 'vivid']];
  const expected = suggest(...picks);
  assert.deepEqual(new Set(expected.options), new Set(picks.flat()));
  assert.deepEqual(expected.defaultTags, ['landscape', 'people']);
  assert.deepEqual(suggest(...[...picks].reverse()), expected);
  assert.deepEqual(suggest(...picks.map(tags => [...tags].reverse())), expected);
});

test('a wide tie at the highest frequency skips a lower-frequency tag', () => {
  assert.deepEqual(suggest(['light', 'soft'], ['warm'], ['people'], ['people', 'light'], ['warm']).defaultTags,
    ['people', 'light']);
});

test('no tags are suggested without tagged picks', () => {
  assert.deepEqual(suggest([]), { options: [], defaultTags: [] });
});

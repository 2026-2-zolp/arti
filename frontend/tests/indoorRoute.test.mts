import assert from 'node:assert/strict';
import test from 'node:test';
import { canWalkSegment, indoorLeg, indoorSequence, type IndoorLayout } from '../src/lib/indoorRoute';
import { indoorMapFixture } from '../src/lib/indoorMapFixture';
import { fitNavigationDraft, suggestNavigationWaypoints } from '../src/lib/navigationDraft';
import { twoRoomNavigationPreset } from '../src/lib/navigationPresets';
import type { NavigationLayoutInput } from '../src/types';

const fixture = {
  id: 'fixture-ex01',
  subtitle: 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION',
};
const pillar = indoorMapFixture({ ...fixture, floorPlan: { file: 'fixture-map-pillar.png', width: 360, height: 640 } })!;
const rooms = indoorMapFixture({ ...fixture, floorPlan: { file: 'fixture-map-two-rooms.png', width: 640, height: 360 } })!;

test('a route around a pillar consists only of walkable segments', () => {
  const left = { x: 20, y: 50 };
  const right = { x: 82, y: 50 };
  assert.equal(canWalkSegment(pillar, left, right), false);
  const detour = indoorLeg(pillar, left, right);
  assert.ok(detour && detour.length > 2);
  for (let index = 1; index < detour.length; index++) {
    assert.equal(canWalkSegment(pillar, detour[index - 1], detour[index]), true);
  }
  assert.equal(indoorLeg(pillar, left, { x: 50, y: 50 }), null);
});

test('sealing a door disconnects the rooms and breaks the itinerary line', () => {
  const left = { x: 20, y: 25 };
  const right = { x: 82, y: 25 };
  const path = indoorLeg(rooms, left, right);
  assert.ok(path?.some(point => point.x < 46 && point.y > 74));
  assert.ok(path?.some(point => point.x > 54 && point.y > 74));
  const sealed = { ...rooms, barriers: [...rooms.barriers, { x: 36, y: 72, w: 8, h: 2 }] };
  assert.equal(indoorLeg(sealed, left, right), null);
  assert.deepEqual(indoorSequence(sealed, [left, right]), [left, null, right]);
});

test('a map with no registered link across open space and a replaced plan do not infer travel', () => {
  const separated = { ...pillar, barriers: [], walkable: [{ x: 0, y: 0, w: 40, h: 60 }, { x: 60, y: 0, w: 40, h: 60 }] };
  const left = { x: 20, y: 25 };
  const right = { x: 82, y: 25 };
  assert.equal(indoorLeg(separated, left, right), null);
  assert.deepEqual(indoorSequence(pillar, [left, null, right]), [left, null, right]);
  assert.equal(indoorMapFixture({ ...fixture, floorPlan: { file: 'replacement.png', width: 360, height: 640 } }), undefined);
});

function navigationGeometry(layout: NavigationLayoutInput): IndoorLayout {
  return {
    aspect: 640 / 360,
    walkable: [...layout.walkable, ...layout.doors, ...layout.corridors],
    barriers: [...layout.walls, ...layout.pillars],
    waypoints: layout.waypoints,
  };
}

test('fitting a draft to either corner order keeps the doorway geometry connected', () => {
  const first = { x: 10, y: 8 };
  const last = { x: 90, y: 88 };
  const fitted = fitNavigationDraft(twoRoomNavigationPreset, last, first);
  assert.ok(fitted);
  assert.deepEqual(fitted, fitNavigationDraft(twoRoomNavigationPreset, first, last));
  assert.deepEqual({ x: fitted.walkable[0].x, y: fitted.walkable[0].y }, first);
  const corridor = fitted.corridors[0];
  assert.deepEqual({ x: corridor.x + corridor.w, y: corridor.y + corridor.h }, last);
  assert.equal(fitNavigationDraft(twoRoomNavigationPreset, first, { x: 10, y: 88 }), null);
  assert.ok(indoorLeg(navigationGeometry(fitted), { x: 24, y: 26 }, { x: 78, y: 26 }));
});

test('door suggestions connect open rooms and skip openings obstructed by a wall', () => {
  const left = { x: 20, y: 25 };
  const right = { x: 82, y: 25 };
  const draft = { ...twoRoomNavigationPreset, waypoints: [] };
  const connected = suggestNavigationWaypoints(draft, navigationGeometry(draft));
  assert.equal(connected.length, 6);
  assert.ok(indoorLeg({ ...navigationGeometry(draft), waypoints: connected }, left, right));
  const applied = { ...draft, waypoints: connected };
  assert.deepEqual(suggestNavigationWaypoints(applied, navigationGeometry(applied)), []);

  const obstructed = { ...draft, walls: [...draft.walls, { x: 56, y: 72, w: 8, h: 2 }] };
  const suggestions = suggestNavigationWaypoints(obstructed, navigationGeometry(obstructed));
  assert.ok(suggestions.every(point => point.x < 46));
  assert.equal(indoorLeg({ ...navigationGeometry(obstructed), waypoints: suggestions }, left, right), null);
});

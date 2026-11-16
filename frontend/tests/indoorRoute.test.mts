import assert from 'node:assert/strict';
import test from 'node:test';
import { canWalkSegment, indoorLeg, indoorSequence } from '../src/lib/indoorRoute';
import { indoorMapFixture } from '../src/lib/indoorMapFixture';

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

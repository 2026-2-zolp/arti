import type { NavigationLayoutInput } from '../types';

export const twoRoomNavigationPreset: NavigationLayoutInput = {
  walkable: [{ x: 4, y: 4, w: 42, h: 68 }, { x: 54, y: 4, w: 42, h: 68 }],
  walls: [
    { x: 46, y: 4, w: 8, h: 70 },
    { x: 4, y: 72, w: 32, h: 2 }, { x: 44, y: 72, w: 2, h: 2 },
    { x: 54, y: 72, w: 2, h: 2 }, { x: 64, y: 72, w: 32, h: 2 },
  ],
  pillars: [],
  doors: [{ x: 36, y: 71, w: 8, h: 4 }, { x: 56, y: 71, w: 8, h: 4 }],
  corridors: [{ x: 4, y: 74, w: 92, h: 22 }],
  waypoints: [
    { x: 40, y: 70 }, { x: 40, y: 76 }, { x: 40, y: 85 },
    { x: 60, y: 85 }, { x: 60, y: 76 }, { x: 60, y: 70 },
  ],
};

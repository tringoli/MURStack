import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addWingToBuilding,
  getBuildingWings,
  mergeBuildings,
  removeWingFromBuilding,
  resizeBuildingWingCorner,
  resizeBuildingWingHeight,
  rotateBuilding,
  splitBuilding,
} from './buildingOps';
import { createRectFootprint } from './projection';
import type { Building3D } from '../types/map';

function makeBuilding(id: string, x: number, z: number, width = 40, depth = 20): Building3D {
  return {
    id,
    name: `Дом ${id}`,
    street: 'ул. Советская',
    houseNumber: id,
    district: 'Центр',
    category: 'residential',
    x,
    z,
    footprint: createRectFootprint(x, z, width, depth, 0),
    measuredWidth: width,
    measuredDepth: depth,
    orientationDeg: 0,
    floors: 5,
    height: 24,
    baseY: 64,
    roofY: 88,
  };
}

test('rotateBuilding rotates single building footprint cleanly and updates orientationDeg', () => {
  const b = makeBuilding('1', 100, 200, 40, 20);
  const rotated = rotateBuilding(b, 90);
  assert.equal(rotated.orientationDeg, 90);

  // At 90 degrees, width (40) aligns along Z and depth (20) aligns along X
  const xs = rotated.footprint.map((p) => p.x);
  const zs = rotated.footprint.map((p) => p.z);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  assert.equal(spanX, 20);
  assert.equal(spanZ, 40);
});

test('addWingToBuilding and removeWingFromBuilding manage complex корпуса under one address', () => {
  const b = makeBuilding('10', 0, 0, 40, 20);
  assert.equal(getBuildingWings(b).length, 1);

  const { building: withWing2, newWingId } = addWingToBuilding(b);
  assert.equal(getBuildingWings(withWing2).length, 2);
  assert.equal(withWing2.houseNumber, '10');
  assert.equal(withWing2.street, 'ул. Советская');
  assert.ok(withWing2.wings && withWing2.wings.length === 2);

  // Resize height on second wing only
  const tallWing = resizeBuildingWingHeight(withWing2, newWingId, 48);
  assert.equal(tallWing.wings![0].height, 24);
  assert.equal(tallWing.wings![1].height, 48);
  assert.equal(tallWing.height, 48);

  // Removing wing 2 collapses back to a clean single-volume building
  const removed = removeWingFromBuilding(tallWing, newWingId);
  assert.equal(removed.removed, true);
  assert.equal(removed.building.wings, undefined);
  assert.equal(getBuildingWings(removed.building).length, 1);
  assert.equal(removed.building.height, 24);

  // Cannot remove last remaining wing
  const lastAttempt = removeWingFromBuilding(removed.building, removed.nextActiveWingId);
  assert.equal(lastAttempt.removed, false);
});

test('mergeBuildings combines two buildings into one address and splitBuilding separates them back', () => {
  const b1 = makeBuilding('15', 0, 0, 40, 20);
  const b2 = makeBuilding('17', 60, 0, 30, 30);

  const merged = mergeBuildings(b1, b2);
  assert.equal(merged.id, b1.id);
  assert.equal(merged.houseNumber, '15');
  assert.equal(getBuildingWings(merged).length, 2);

  const separated = splitBuilding(merged);
  assert.equal(separated.length, 2);
  assert.equal(separated[0].id, b1.id);
  assert.equal(separated[0].wings, undefined);
  assert.equal(separated[1].wings, undefined);
  assert.equal(separated[1].x, 60);
});

test('splitBuilding bisects a single rectangular building along its longer axis', () => {
  const wide = makeBuilding('20', 0, 0, 60, 20);
  const parts = splitBuilding(wide);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].x < 0 && parts[1].x > 0, 'wide building should split along X');
  assert.equal(parts[0].measuredDepth, 20);
  assert.equal(parts[1].measuredDepth, 20);
  assert.ok((parts[0].measuredWidth ?? 0) < 35 && (parts[1].measuredWidth ?? 0) < 35);
});

test('resizeBuildingWingCorner resizes a wing while preserving opposite corner anchor', () => {
  const b = makeBuilding('30', 0, 0, 40, 20);
  const wId = getBuildingWings(b)[0].id;
  // Corner 2 is (+20, +10), opposite corner 0 is (-20, -10)
  const resized = resizeBuildingWingCorner(b, wId, 2, { x: 40, z: 30 });
  assert.equal(resized.measuredWidth, 60);
  assert.equal(resized.measuredDepth, 40);
});

test('Editor building ops support 300-floor skyscrapers and tiny 2x2m structures without size limits', () => {
  const b = makeBuilding('300', 0, 0, 40, 40);
  const wId = getBuildingWings(b)[0].id;
  const skyscraper = resizeBuildingWingHeight(b, wId, 1260);
  assert.equal(skyscraper.height, 1260);
  assert.ok(skyscraper.floors >= 300, `Expected >= 300 floors, got ${skyscraper.floors}`);

  // Tiny 2x2m kiosk
  const tiny = resizeBuildingWingCorner(b, wId, 2, { x: -18, z: -18 });
  assert.ok((tiny.measuredWidth ?? 99) <= 2.5, `Expected width <= 2.5m, got ${tiny.measuredWidth}`);
  assert.ok((tiny.measuredDepth ?? 99) <= 2.5, `Expected depth <= 2.5m, got ${tiny.measuredDepth}`);
});


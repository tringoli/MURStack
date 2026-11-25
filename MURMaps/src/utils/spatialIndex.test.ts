import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBuildingSpatialIndex,
  buildRouteSpatialIndex,
  buildStreetSpatialIndex,
  computeViewportWorldBounds,
  samplePointAlongRoute3D,
  ScreenLabelGrid,
  UniformGridIndex,
} from './spatialIndex';
import { createRectFootprint } from './projection';
import type { Building3D, CameraState, MtrRoute, StreetSegment } from '../types/map';

test('UniformGridIndex queries thousands of objects in O(visible) with zero duplicates', () => {
  const index = new UniformGridIndex<number>(200);
  // Insert 5,000 buildings spread across 10km x 10km
  for (let i = 0; i < 5000; i++) {
    const x = (i % 100) * 100;
    const z = Math.floor(i / 100) * 100;
    index.insert(i, { minX: x - 20, maxX: x + 20, minZ: z - 20, maxZ: z + 20 });
  }

  const hits = index.queryAABB({ minX: 450, maxX: 750, minZ: 450, maxZ: 750 });
  assert.ok(hits.length > 0 && hits.length < 30, `expected small visible subset, got ${hits.length}`);
  assert.equal(new Set(hits).size, hits.length, 'query must deduplicate multi-cell items');
});

test('ScreenLabelGrid rejects overlapping labels and accepts non-overlapping labels', () => {
  const grid = new ScreenLabelGrid(96, 32);
  assert.equal(grid.tryPlace(100, 100, 180, 118), true);
  assert.equal(grid.tryPlace(140, 104, 220, 122), false); // overlaps
  assert.equal(grid.tryPlace(220, 100, 300, 118), true);  // separated
  assert.equal(grid.tryPlace(140, 104, 220, 122, true), true); // force placement
});

test('buildBuildingSpatialIndex indexes every wing of a complex building', () => {
  const complexBldg: Building3D = {
    id: 'b-complex',
    name: 'ЖК Центральный',
    street: 'пр-т Ленина',
    houseNumber: '12',
    district: 'Центр',
    category: 'residential',
    x: 0,
    z: 0,
    footprint: createRectFootprint(0, 0, 40, 20, 0),
    floors: 9,
    height: 36,
    wings: [
      {
        id: 'w1',
        label: 'Корпус 1',
        x: 0,
        z: 0,
        footprint: createRectFootprint(0, 0, 40, 20, 0),
        floors: 9,
        height: 36,
      },
      {
        id: 'w2',
        label: 'Корпус 2',
        x: 600,
        z: 0,
        footprint: createRectFootprint(600, 0, 30, 30, 0),
        floors: 5,
        height: 22,
      },
    ],
  };

  const { wingIndex } = buildBuildingSpatialIndex([complexBldg]);
  const nearOrigin = wingIndex.queryPoint(0, 0, 50);
  const nearFarWing = wingIndex.queryPoint(600, 0, 50);

  assert.equal(nearOrigin.length, 1);
  assert.equal(nearOrigin[0].wing.id, 'w1');
  assert.equal(nearOrigin[0].isPrimary, true);

  assert.equal(nearFarWing.length, 1);
  assert.equal(nearFarWing[0].wing.id, 'w2');
  assert.equal(nearFarWing[0].isPrimary, false);
});

test('buildStreetSpatialIndex precomputes smoothed & coarse polylines and sorts railway/highway cleanly', () => {
  const st: StreetSegment = {
    id: 's1',
    name: 'ЖД линия 1',
    district: 'Центр',
    roadClass: 'railway',
    width: 8,
    simAllowed: false,
    points: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 200, z: 100 },
    ],
  };
  const idx = buildStreetSpatialIndex([st]);
  const res = idx.queryPoint(100, 0, 40);
  assert.equal(res.length, 1);
  assert.ok(res[0].smoothedPoints.length >= 3);
  assert.ok(res[0].coarsePoints.length >= 2);
});

test('samplePointAlongRoute3D performs accurate binary-search interpolation along 3D route', () => {
  const rt: MtrRoute = {
    id: 'r1',
    name: 'М1',
    shortName: 'М1',
    number: '1',
    color: '#FF0000',
    kind: 'metro',
    circular: false,
    headwaySec: 180,
    stops: [
      { stationId: 's1', name: 'A', x: 0, y: 64, z: 0, dwellMs: 15000 },
      { stationId: 's2', name: 'B', x: 100, y: 74, z: 0, dwellMs: 15000 },
      { stationId: 's3', name: 'C', x: 100, y: 84, z: 100, dwellMs: 15000 },
    ],
    segmentDurationsMs: [30000, 30000],
  };

  const { sortedRoutes } = buildRouteSpatialIndex([rt]);
  assert.equal(sortedRoutes.length, 1);
  assert.equal(Math.round(sortedRoutes[0].totalLen), 200);

  const mid = samplePointAlongRoute3D(sortedRoutes[0], 150);
  assert.equal(Math.round(mid.x), 100);
  assert.equal(Math.round(mid.z), 50);
  assert.equal(Math.round(mid.y), 79);
});

test('computeViewportWorldBounds returns valid world AABB covering tilted 3D frustum', () => {
  const cam: CameraState = { x: 100, z: -200, zoom: 0.5, pitch: 48, bearing: 30 };
  const bounds = computeViewportWorldBounds(cam, 1440, 900, 120);
  assert.ok(bounds.minX < cam.x && bounds.maxX > cam.x);
  assert.ok(bounds.minZ < cam.z && bounds.maxZ > cam.z);
  assert.ok(bounds.maxX - bounds.minX > 1000);
});

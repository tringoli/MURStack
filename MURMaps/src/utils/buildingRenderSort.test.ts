import test from 'node:test';
import assert from 'node:assert/strict';
import type { Building3D, CameraState } from '../types/map';
import { createRectFootprint, hitTestBuildingWithWing, worldToScreen } from './projection';
import { buildBuildingSpatialIndex } from './spatialIndex';
import {
  sortBuildingRenderSlices,
  type BuildingRenderSlicePlan,
  type SortableBuildingSlice,
} from './buildingRenderSort';
import { SERVER_GROUND_Y } from './geometry';

function makeComplexBuilding(
  id: string,
  wings: Array<{
    id: string;
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    baseY?: number;
    angleDeg?: number;
  }>
): Building3D {
  const mappedWings = wings.map((cfg, idx) => {
    const baseY = cfg.baseY ?? SERVER_GROUND_Y;
    return {
      id: cfg.id,
      label: `Корпус ${idx + 1}`,
      x: cfg.x,
      z: cfg.z,
      footprint: createRectFootprint(cfg.x, cfg.z, cfg.w, cfg.d, cfg.angleDeg ?? 0),
      height: cfg.h,
      floors: Math.max(1, Math.round(cfg.h / 4)),
      baseY,
      roofY: baseY + cfg.h,
      measuredWidth: cfg.w,
      measuredDepth: cfg.d,
      orientationDeg: cfg.angleDeg ?? 0,
    };
  });

  const primary = mappedWings[0];
  return {
    id,
    name: `Здание ${id}`,
    street: 'Центральный пр.',
    houseNumber: id,
    district: 'Центр',
    category: 'civic',
    x: primary.x,
    z: primary.z,
    footprint: primary.footprint,
    height: Math.max(...mappedWings.map((w) => w.height)),
    floors: Math.max(...mappedWings.map((w) => w.floors)),
    baseY: primary.baseY,
    roofY: Math.max(...mappedWings.map((w) => w.roofY ?? SERVER_GROUND_Y + w.height)),
    shapeType: mappedWings.length > 1 ? 'complex' : 'rectangular',
    wings: mappedWings.length > 1 ? mappedWings : undefined,
  };
}

function buildSortableForCamera(
  buildings: Building3D[],
  camera: CameraState,
  useElevY = true
): SortableBuildingSlice<{ wingId: string; slice: BuildingRenderSlicePlan; sliceIdx: number }>[] {
  const { wingIndex } = buildBuildingSpatialIndex(buildings);
  const all = wingIndex.queryAABB({ minX: -500, maxX: 500, minZ: -500, maxZ: 500 });
  const out: SortableBuildingSlice<{
    wingId: string;
    slice: BuildingRenderSlicePlan;
    sliceIdx: number;
  }>[] = [];

  for (const item of all) {
    const rawBaseY = item.wing.baseY ?? item.building.baseY ?? SERVER_GROUND_Y;
    const baseElev = useElevY ? Math.max(-18, rawBaseY - SERVER_GROUND_Y) : 0;

    item.renderSlices.forEach((slice, sliceIdx) => {
      const minElev = baseElev + (slice.minY - rawBaseY);
      const maxElev = baseElev + (slice.maxY - rawBaseY);
      let screenMinX = Infinity;
      let screenMaxX = -Infinity;
      let screenMinY = Infinity;
      let screenMaxY = -Infinity;
      for (const pt of slice.sortPoly) {
        const pb = worldToScreen(pt.x, pt.z, minElev, camera, 1200, 800);
        const pr = worldToScreen(pt.x, pt.z, maxElev, camera, 1200, 800);
        screenMinX = Math.min(screenMinX, pb.sx, pr.sx);
        screenMaxX = Math.max(screenMaxX, pb.sx, pr.sx);
        screenMinY = Math.min(screenMinY, pb.sy, pr.sy);
        screenMaxY = Math.max(screenMaxY, pb.sy, pr.sy);
      }
      out.push({
        payload: { wingId: item.wing.id, slice, sliceIdx },
        sortPoly: slice.sortPoly,
        minY: minElev,
        maxY: maxElev,
        screenMinX,
        screenMaxX,
        screenMinY,
        screenMaxY,
      });
    });
  }
  return out;
}

test('Nested tall spire inside central tower clips buried lower shaft and draws above tower from all 360°', () => {
  // Mirrors the user-reported Building 61: central tower + flanking wings + off-center tall spire
  const bldg61 = makeComplexBuilding('61', [
    { id: 'center', x: 0, z: 0, w: 20, d: 20, h: 40 },
    { id: 'left', x: -16, z: 0, w: 10, d: 18, h: 20 },
    { id: 'right', x: 16, z: 0, w: 10, d: 18, h: 20 },
    { id: 'spire', x: 0, z: -5, w: 3, d: 3, h: 55 },
  ]);

  const { wingIndex } = buildBuildingSpatialIndex([bldg61]);
  const indexed = wingIndex.queryAABB({ minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
  const spireEntry = indexed.find((w) => w.wing.id === 'spire');
  assert.ok(spireEntry, 'spire wing must be indexed');
  assert.equal(spireEntry.renderSlices.length, 1, 'fully nested spire needs only 1 elevated slice');
  assert.equal(
    spireEntry.renderSlices[0].minY,
    SERVER_GROUND_Y + 40,
    'spire walls buried inside center tower [64..104] must be clipped away'
  );
  assert.equal(spireEntry.renderSlices[0].maxY, SERVER_GROUND_Y + 55);
  assert.ok(
    spireEntry.renderSlices[0].wallSlices.every((ws) => ws.minY >= SERVER_GROUND_Y + 40 - 0.01),
    'every exposed wall slice of the nested spire must start at or above the central tower roof'
  );

  // Verify draw order across all 12 bearings (0°, 30°, ..., 330°)
  for (let bearing = 0; bearing < 360; bearing += 30) {
    const cam: CameraState = { x: 0, z: 0, zoom: 6, pitch: 48, bearing };
    const sortable = buildSortableForCamera([bldg61], cam);
    const ordered = sortBuildingRenderSlices(sortable, cam);
    const idxCenter = ordered.findIndex((o) => o.wingId === 'center');
    const idxSpire = ordered.findIndex((o) => o.wingId === 'spire');
    assert.ok(
      idxCenter >= 0 && idxSpire > idxCenter,
      `At bearing ${bearing}°, center tower (${idxCenter}) must draw BEFORE nested spire (${idxSpire})`
    );
  }
});

test('Exact 2D camera-ray sort prevents small tower behind large diagonal building from popping through', () => {
  // Large 50x10 diagonal hall at 45°; small 4x4 tower strictly behind its front-right half
  // Centroid depth of small tower (+4) would wrongly exceed centroid depth of hall (0)!
  const hall = makeComplexBuilding('hall', [
    { id: 'hall-w1', x: 0, z: 0, w: 50, d: 10, h: 30, angleDeg: 45 },
  ]);
  const backKiosk = makeComplexBuilding('kiosk', [
    { id: 'kiosk-w1', x: 16, z: 4, w: 4, d: 4, h: 25, angleDeg: 0 },
  ]);

  const cam: CameraState = { x: 0, z: 0, zoom: 5, pitch: 48, bearing: 0 };
  const sortable = buildSortableForCamera([hall, backKiosk], cam);
  const ordered = sortBuildingRenderSlices(sortable, cam);
  const idxKiosk = ordered.findIndex((o) => o.wingId === 'kiosk-w1');
  const idxHall = ordered.findIndex((o) => o.wingId === 'hall-w1');

  assert.ok(
    idxKiosk < idxHall,
    `Small tower behind diagonal hall must draw BEFORE hall (got kiosk=${idxKiosk}, hall=${idxHall})`
  );
});

test('Cross-shaped (+) intersecting multi-height wings split into back arm, low bar, front arm, and upper tower', () => {
  const cross = makeComplexBuilding('cross', [
    { id: 'lowBar', x: 0, z: 0, w: 60, d: 10, h: 20 },
    { id: 'tallBar', x: 0, z: 0, w: 10, d: 60, h: 40 },
  ]);

  const { wingIndex } = buildBuildingSpatialIndex([cross]);
  const indexed = wingIndex.queryAABB({ minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
  const tallEntry = indexed.find((w) => w.wing.id === 'tallBar')!;
  assert.equal(
    tallEntry.renderSlices.length,
    3,
    'tallBar crossing lowBar must split into 2 disconnected lower arms + 1 upper roofed slice'
  );

  // Viewing from South (bearing = 0°): north arm (z < -5) is behind lowBar, south arm (z > +5) is in front
  const camSouth: CameraState = { x: 0, z: 0, zoom: 4, pitch: 48, bearing: 0 };
  const orderedSouth = sortBuildingRenderSlices(buildSortableForCamera([cross], camSouth), camSouth);

  const idxLow = orderedSouth.findIndex((o) => o.wingId === 'lowBar');
  const idxUpper = orderedSouth.findIndex((o) => o.wingId === 'tallBar' && o.slice.drawRoof);
  const idxNorthArm = orderedSouth.findIndex(
    (o) => o.wingId === 'tallBar' && !o.slice.drawRoof && o.slice.aabb.maxZ <= -4
  );
  const idxSouthArm = orderedSouth.findIndex(
    (o) => o.wingId === 'tallBar' && !o.slice.drawRoof && o.slice.aabb.minZ >= 4
  );

  assert.ok(idxNorthArm >= 0 && idxSouthArm >= 0 && idxLow >= 0 && idxUpper >= 0);
  assert.ok(idxNorthArm < idxLow, `North lower arm (${idxNorthArm}) must draw before lowBar (${idxLow})`);
  assert.ok(idxLow < idxSouthArm, `lowBar (${idxLow}) must draw before South lower arm (${idxSouthArm})`);
  assert.ok(idxLow < idxUpper, `lowBar (${idxLow}) must draw before upper tallBar (${idxUpper})`);

  // Viewing from North (bearing = 180°): roles of north and south arms reverse cleanly!
  const camNorth: CameraState = { x: 0, z: 0, zoom: 4, pitch: 48, bearing: 180 };
  const orderedNorth = sortBuildingRenderSlices(buildSortableForCamera([cross], camNorth), camNorth);
  const idxLowN = orderedNorth.findIndex((o) => o.wingId === 'lowBar');
  const idxNorthArmN = orderedNorth.findIndex(
    (o) => o.wingId === 'tallBar' && !o.slice.drawRoof && o.slice.aabb.maxZ <= -4
  );
  const idxSouthArmN = orderedNorth.findIndex(
    (o) => o.wingId === 'tallBar' && !o.slice.drawRoof && o.slice.aabb.minZ >= 4
  );
  const idxUpperN = orderedNorth.findIndex((o) => o.wingId === 'tallBar' && o.slice.drawRoof);

  assert.ok(idxSouthArmN < idxLowN, 'From North, South lower arm must draw before lowBar');
  assert.ok(idxLowN < idxNorthArmN, 'From North, lowBar must draw before North lower arm');
  assert.ok(idxLowN < idxUpperN, 'From North, lowBar must draw before upper tallBar');
});

test('Four-tier off-center stepped skyscraper sorts strictly bottom-to-top from every angle', () => {
  const tower = makeComplexBuilding('sky', [
    { id: 't1', x: 0, z: 0, w: 40, d: 40, h: 16 },
    { id: 't2', x: 4, z: -4, w: 28, d: 28, h: 32 },
    { id: 't3', x: 6, z: -6, w: 16, d: 16, h: 52 },
    { id: 't4', x: 7, z: -7, w: 4, d: 4, h: 76 },
  ]);

  for (let bearing = 0; bearing < 360; bearing += 45) {
    const cam: CameraState = { x: 0, z: 0, zoom: 4, pitch: 48, bearing };
    const ordered = sortBuildingRenderSlices(buildSortableForCamera([tower], cam), cam);
    const i1 = ordered.findIndex((o) => o.wingId === 't1');
    const i2 = ordered.findIndex((o) => o.wingId === 't2');
    const i3 = ordered.findIndex((o) => o.wingId === 't3');
    const i4 = ordered.findIndex((o) => o.wingId === 't4');
    assert.ok(
      i1 < i2 && i2 < i3 && i3 < i4,
      `At bearing ${bearing}°, tiers must draw in strict bottom-to-top order (got ${i1},${i2},${i3},${i4})`
    );
  }
});

test('Elevated skybridge wing draws above ground lobby and correctly behind front tower', () => {
  const complex = makeComplexBuilding('bridge', [
    { id: 'lobby', x: 0, z: 0, w: 30, d: 20, h: 12, baseY: SERVER_GROUND_Y },
    { id: 'skybridge', x: 0, z: 0, w: 26, d: 8, h: 8, baseY: SERVER_GROUND_Y + 28 },
    { id: 'frontTower', x: 0, z: 16, w: 14, d: 10, h: 60, baseY: SERVER_GROUND_Y },
  ]);

  const cam: CameraState = { x: 0, z: 0, zoom: 4, pitch: 48, bearing: 0 };
  const ordered = sortBuildingRenderSlices(buildSortableForCamera([complex], cam, true), cam);
  const idxLobby = ordered.findIndex((o) => o.wingId === 'lobby');
  const idxBridge = ordered.findIndex((o) => o.wingId === 'skybridge');
  const idxFront = ordered.findIndex((o) => o.wingId === 'frontTower');

  assert.ok(idxLobby < idxBridge, 'Ground lobby must draw before elevated skybridge above it');
  assert.ok(idxBridge < idxFront, 'Skybridge behind tall front tower must draw before front tower');
});

test('hitTestBuildingWithWing selects nested tall spire above tower roof and tower on front facade', () => {
  const bldg61 = makeComplexBuilding('61', [
    { id: 'center', x: 0, z: 0, w: 20, d: 20, h: 40 },
    { id: 'spire', x: 0, z: -5, w: 3, d: 3, h: 55 },
  ]);

  for (const bearing of [0, 180]) {
    const cam: CameraState = { x: 0, z: 0, zoom: 6, pitch: 48, bearing };
    const spireTop = worldToScreen(0, -5, 55, cam, 1200, 800);
    const hitSpire = hitTestBuildingWithWing(spireTop.sx, spireTop.sy, [bldg61], cam, 1200, 800, true);
    assert.equal(
      hitSpire?.wingId,
      'spire',
      `Clicking spire roof at bearing ${bearing}° must select spire wing`
    );

    // Clicking the middle of center tower's front-most face (halfway up) must select center tower, never buried spire!
    const frontZ = bearing === 0 ? 10 : -10;
    const centerFrontMid = worldToScreen(0, frontZ, 20, cam, 1200, 800);
    const hitCenter = hitTestBuildingWithWing(
      centerFrontMid.sx,
      centerFrontMid.sy,
      [bldg61],
      cam,
      1200,
      800,
      true
    );
    assert.equal(
      hitCenter?.wingId,
      'center',
      `Clicking center tower front facade at bearing ${bearing}° must select center wing`
    );
  }
});

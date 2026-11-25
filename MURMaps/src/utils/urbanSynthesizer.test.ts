import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBlueMapTileRgba,
  extractBuildingsFrom3DGrid,
  extractStreetsWithRealWidth,
  runUrbanSynthesisPipeline,
  stitchHeightColorGrids,
  tracePublicTransitOverStreets,
  voxelize3DObjects,
} from './urbanSynthesizer';
import {
  extractMagicRailPoints3D,
  getRouteIdsForMagicRail,
  parseMagicRailsPayload,
  traceRoutesFromMagicRails,
} from './magicTracks';
import {
  getRoadHierarchyLevel,
  resizeBuildingFromCornerHandle,
  smoothMagic3DPath,
  smoothStreetPolyline,
  snapBuildingRectToStreet,
} from './geometry';
import {
  decodeTerrainElevationTile,
  sampleTerrainElevation,
} from './terrainRelief';
import type { Building3D, MtrRoute, StreetSegment } from '../types/map';

test('BlueMap RGBA decoder extracts RGB color, signed 16-bit Y height, multi-LOD scale, and exact area crop', () => {
  const w = 10;
  const h = 20;
  const rgba = new Uint8ClampedArray(w * h * 4);

  const topOff = (5 * w + 5) * 4;
  rgba[topOff] = 150;
  rgba[topOff + 1] = 97;
  rgba[topOff + 2] = 83;
  rgba[topOff + 3] = 255;

  const botOff = ((5 + 10) * w + 5) * 4;
  rgba[botOff] = 3;
  rgba[botOff + 1] = 0;
  rgba[botOff + 2] = 94;
  rgba[botOff + 3] = 255;

  // LOD 1 full tile
  const grid = decodeBlueMapTileRgba(rgba, w, h, 21, -2, 2, 1);
  const idx = 2 * grid.cols + 2;
  assert.equal(grid.originX, 21 * 500);
  assert.equal(grid.originZ, -2 * 500);
  assert.equal(grid.heights[idx], 94);
  assert.equal(grid.rgb[idx * 3], 150);

  // LOD 2 (5 blocks/pixel -> 2500 blocks/tile)
  const gridLod2 = decodeBlueMapTileRgba(rgba, w, h, 4, -1, 5, 2);
  assert.equal(gridLod2.originX, 4 * 2500);
  assert.equal(gridLod2.cellSize, 5);
  assert.equal(gridLod2.heights[5 * gridLod2.cols + 5], 94);

  // Micro 5 m² crop around pixel (5,5) at LOD 1 (world X=10505, Z=-995)
  const micro = decodeBlueMapTileRgba(rgba, w, h, 21, -2, 1, 1, {
    minX: 21 * 500 + 4,
    maxX: 21 * 500 + 7,
    minZ: -2 * 500 + 4,
    maxZ: -2 * 500 + 7,
  });
  assert.equal(micro.cols, 3);
  assert.equal(micro.rows, 3);
  assert.equal(micro.heights[1 * micro.cols + 1], 94);
});

test('Roof verification rejects hollow structures without a roof and classifies flat/pitched/curved/complex roofs above server Y', () => {
  const grid = voxelize3DObjects(
    [
      // Valid flat-roof building
      { x: 90, z: 90, width: 48, depth: 36, baseY: 67, topY: 91, roofStyle: 'flat', material: 'building' },
      // Valid pitched-roof building
      { x: 210, z: 90, width: 48, depth: 40, baseY: 67, topY: 95, roofStyle: 'pitched', material: 'building' },
      // Valid curved/domed roof building
      { x: 340, z: 90, width: 52, depth: 52, baseY: 67, topY: 101, roofStyle: 'curved', material: 'building' },
      // Valid complex stepped roof building
      { x: 140, z: 240, width: 56, depth: 48, baseY: 67, topY: 103, roofStyle: 'complex', material: 'building' },
      // Hollow walled yard with NO interior roof deck -> MUST BE REJECTED!
      { x: 320, z: 240, width: 54, depth: 54, baseY: 67, topY: 85, hollowNoRoof: true, material: 'building' },
      // Tall green tree canopy -> MUST BE REJECTED!
      { x: 420, z: 240, width: 24, depth: 24, baseY: 67, topY: 88, material: 'foliage', rgb: [52, 98, 40] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 500, depthBlocks: 360 },
    2,
    67
  );

  const bRes = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 5 });
  assert.equal(bRes.buildings.length, 4, 'Should accept 4 roofed buildings and reject hollow yard + tree');
  assert.ok(bRes.rejectedNoRoof >= 1, 'Should record at least 1 structure rejected for lacking a roof');

  const roofTypes = new Set(bRes.buildings.map((b) => b.roofType));
  assert.ok(roofTypes.has('flat'), 'Should classify flat roof');
  assert.ok(roofTypes.has('pitched') || roofTypes.has('curved') || roofTypes.has('complex'), 'Should classify non-flat roof profiles');
  for (const b of bRes.buildings) {
    assert.ok((b.roofY ?? 0) > (b.baseY ?? 67), 'Verified building roofY must exceed server ground baseY');
  }
});

test('Target mode supports buildings-only and streets-only generation plus orange highway classification', () => {
  const grid = voxelize3DObjects(
    [
      // 30-block wide expressway -> should classify as 'highway'
      { x: 250, z: 200, width: 440, depth: 30, baseY: 67, topY: 67, material: 'road' },
      // 12-block side street
      { x: 200, z: 250, width: 12, depth: 360, baseY: 67, topY: 67, material: 'road' },
      // Two valid buildings
      { x: 110, z: 110, width: 52, depth: 36, baseY: 67, topY: 91, material: 'building' },
      { x: 340, z: 310, width: 44, depth: 44, baseY: 67, topY: 105, material: 'building' },
    ],
    { originX: 0, originZ: 0, widthBlocks: 500, depthBlocks: 500 },
    2,
    67
  );

  const onlyB = runUrbanSynthesisPipeline([grid], [], [], [], { targetMode: 'buildings' }, 'procedural-3d');
  assert.equal(onlyB.buildings.length, 2);
  assert.equal(onlyB.streets.length, 0, 'Buildings-only mode must not emit streets');

  const onlyS = runUrbanSynthesisPipeline([grid], [], [], [], { targetMode: 'streets' }, 'procedural-3d');
  assert.equal(onlyS.buildings.length, 0, 'Streets-only mode must not emit buildings');
  assert.ok(onlyS.streets.length >= 2, 'Streets-only mode should emit extracted streets');

  const hw = onlyS.streets.find((s) => s.roadClass === 'highway');
  assert.ok(hw, '30-block wide corridor should be classified as highway');
  assert.ok(getRoadHierarchyLevel('highway') > getRoadHierarchyLevel('avenue'));
  assert.ok(getRoadHierarchyLevel('avenue') > getRoadHierarchyLevel('street'));
});

test('Stage 3: Traces public transport routes along streets and generates MAGIC 3D smoothed elevation paths', () => {
  const grid = voxelize3DObjects(
    [
      { x: 130, z: 200, width: 180, depth: 20, baseY: 67, topY: 67, material: 'road' },
      { x: 200, z: 290, width: 20, depth: 200, baseY: 67, topY: 67, material: 'road' },
      { x: 115, z: 295, width: 64, depth: 64, baseY: 67, topY: 95, material: 'building' },
    ],
    { originX: 0, originZ: 0, widthBlocks: 450, depthBlocks: 450 },
    2,
    67
  );

  const busRoute: MtrRoute = {
    id: 'bus-test-1',
    name: 'Автобус №10',
    shortName: '10',
    number: '10',
    color: '#086C14',
    kind: 'bus',
    circular: false,
    stops: [
      { stationId: 'a', name: 'Западная', x: 60, y: 67, z: 200, dwellMs: 10000 },
      { stationId: 'b', name: 'Южная', x: 200, y: 74, z: 370, dwellMs: 10000 },
    ],
    segmentDurationsMs: [35000],
    headwaySec: 180,
  };

  const result = runUrbanSynthesisPipeline([grid], [], [], [busRoute], {}, 'procedural-3d');
  assert.equal(result.stats.buildingsExtracted, 1);
  assert.ok(result.stats.streetsExtracted >= 1);
  assert.equal(result.stats.routesSnapped, 1);

  const traced = result.routes[0];
  assert.equal(traced.snappedToStreets, true);
  assert.equal(traced.magicSmoothed, true);
  assert.ok((traced.tracedPath3D?.length ?? 0) > 2, 'MAGIC 3D trace must contain smoothed 3D waypoints');
  assert.ok(
    traced.tracedPath3D!.some((pt) => pt.y > 67 && pt.y < 74),
    'MAGIC 3D path should interpolate Y elevation smoothly between stops'
  );

  const passesNearCorner = traced.tracedPath!.some(
    (pt) => Math.hypot(pt.x - 200, pt.z - 200) < 35
  );
  assert.ok(passesNearCorner, 'Traced public transit line should bend around the street intersection');

  const secondBus = { ...busRoute, id: 'bus-test-2', number: '12' };
  const bundled = tracePublicTransitOverStreets([busRoute, secondBus], result.streets);
  assert.notEqual(
    bundled.tracedRoutes[0].corridorOffset,
    bundled.tracedRoutes[1].corridorOffset,
    'Overlapping transit routes on same corridor should receive distinct lane offsets'
  );
});

test('Geometry helpers: smooth turns, MAGIC 3D spline, road-snapped area building, and direct corner resize', () => {
  // 1. Smooth street corner filleting
  const sharp = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 100 },
  ];
  const smooth = smoothStreetPolyline(sharp, 20, 4);
  assert.ok(smooth.length > sharp.length, 'Smooth polyline should subdivide sharp 90° turn');
  assert.deepEqual(smooth[0], sharp[0]);
  assert.deepEqual(smooth[smooth.length - 1], sharp[2]);

  // 2. MAGIC 3D Catmull-Rom smoothing
  const raw3D = [
    { x: 0, y: 28, z: 0 },
    { x: 120, y: 68, z: 0 },
    { x: 240, y: 125, z: 100 },
  ];
  const sm3D = smoothMagic3DPath(raw3D, 3);
  assert.ok(sm3D.length >= 7);
  assert.equal(sm3D[0].y, 28);
  assert.equal(sm3D[sm3D.length - 1].y, 125);

  // 3. Road-snapped building creation from literal dragged rectangle
  const streets: StreetSegment[] = [
    {
      id: 'st-diag',
      name: 'Приморская магистраль',
      district: 'Центр',
      roadClass: 'highway',
      width: 24,
      points: [
        { x: 0, z: 0 },
        { x: 200, z: 0 },
      ],
      simAllowed: true,
    },
  ];
  const snapped = snapBuildingRectToStreet({ x: 80, z: 8 }, { x: 130, z: 38 }, streets, true);
  assert.equal(snapped.snapped, true);
  assert.equal(snapped.snappedStreetName, 'Приморская магистраль');
  assert.equal(snapped.angleDeg, 0);
  // Facade must be pushed outside road half-width (12) + 4 sidewalk clearance => z center >= 16 + depth/2
  assert.ok(snapped.z >= 16 + snapped.depth * 0.5 - 1);

  // 4. Direct mouse corner handle resize anchored at opposite corner
  const bldg: Building3D = {
    id: 'b-resize',
    name: 'Дом',
    street: 'Улица',
    houseNumber: '1',
    district: 'Центр',
    category: 'residential',
    x: 100,
    z: 100,
    measuredWidth: 40,
    measuredDepth: 20,
    orientationDeg: 0,
    footprint: [
      { x: 80, z: 90 },
      { x: 120, z: 90 },
      { x: 120, z: 110 },
      { x: 80, z: 110 },
    ],
    height: 20,
    floors: 5,
  };
  const resized = resizeBuildingFromCornerHandle(bldg, 2, { x: 160, z: 130 });
  assert.equal(resized.measuredWidth, 80);
  assert.equal(resized.measuredDepth, 40);
  assert.equal(resized.x, 120);
  assert.equal(resized.z, 110);
});

test('stitchHeightColorGrids merges adjacent BlueMap tiles seamlessly without slicing border buildings', () => {
  const leftTile = voxelize3DObjects(
    [
      { x: 185, z: 100, width: 30, depth: 40, baseY: 67, topY: 91, material: 'building' },
      { x: 70, z: 100, width: 40, depth: 36, baseY: 67, topY: 85, material: 'building' },
    ],
    { originX: 0, originZ: 0, widthBlocks: 200, depthBlocks: 200 },
    2,
    67
  );
  const rightTile = voxelize3DObjects(
    [
      { x: 215, z: 100, width: 30, depth: 40, baseY: 67, topY: 91, material: 'building' },
      { x: 320, z: 100, width: 44, depth: 36, baseY: 67, topY: 95, material: 'building' },
    ],
    { originX: 200, originZ: 0, widthBlocks: 200, depthBlocks: 200 },
    2,
    67
  );

  const stitched = stitchHeightColorGrids([leftTile, rightTile]);
  assert.ok(stitched, 'Stitched grid should be created');
  assert.equal(stitched.originX, 0);
  assert.equal(stitched.cols, 200);
  assert.equal(stitched.rows, 100);

  const res = extractBuildingsFrom3DGrid(stitched, [], { minBuildingHeight: 5 });
  assert.equal(res.buildings.length, 3, 'Seam-straddling building should merge into 1 whole building + 2 flanking buildings');
  const seamBldg = res.buildings.find((b) => Math.abs(b.x - 200) < 12);
  assert.ok(seamBldg, 'Should find unified building centered at tile seam x=200');
  assert.ok((seamBldg.measuredWidth ?? 0) >= 54, `Seam building width should span both tiles (~60m), got ${seamBldg.measuredWidth}`);
});

test('Complex courtyard block decomposition extracts perimeter wings and keeps smooth green roofs while rejecting noisy trees', () => {
  // O-shaped St. Petersburg courtyard block (4 connected wings enclosing an open courtyard) + smooth copper-green roof + rough tree
  const grid = voxelize3DObjects(
    [
      // Courtyard perimeter wings (all connected at corners -> 1 huge O-shaped component before decomposition)
      { x: 150, z: 80, width: 140, depth: 20, baseY: 67, topY: 91, material: 'building', rgb: [165, 110, 92] },
      { x: 150, z: 200, width: 140, depth: 20, baseY: 67, topY: 91, material: 'building', rgb: [165, 110, 92] },
      { x: 90, z: 140, width: 20, depth: 120, baseY: 67, topY: 91, material: 'building', rgb: [165, 110, 92] },
      { x: 210, z: 140, width: 20, depth: 120, baseY: 67, topY: 91, material: 'building', rgb: [165, 110, 92] },
      // Historic smooth oxidized-copper green roof building (flat height, smooth green)
      { x: 330, z: 110, width: 44, depth: 34, baseY: 67, topY: 93, material: 'building', rgb: [62, 114, 72] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 440, depthBlocks: 300 },
    2,
    67
  );

  // Add a noisy multi-height green tree canopy at (330, 220) to verify tree rejection
  for (let r = 95; r < 120; r++) {
    for (let c = 155; c < 180; c++) {
      const idx = r * grid.cols + c;
      const noise = ((r * 7 + c * 13) % 5) * 3;
      grid.heights[idx] = 74 + noise;
      grid.rgb[idx * 3] = 44;
      grid.rgb[idx * 3 + 1] = 102;
      grid.rgb[idx * 3 + 2] = 36;
    }
  }

  const res = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 5, minShapeSolidity: 0.3 });
  const totalWings = res.buildings.reduce((acc, b) => acc + (b.wings ? b.wings.length : 1), 0);
  assert.ok(
    totalWings >= 4,
    `Courtyard perimeter block + copper-roof building should yield >= 4 wings total, got ${totalWings}`
  );
  const courtyardBldg = res.buildings.find((b) => (b.wings?.length ?? 0) >= 3);
  assert.ok(courtyardBldg, 'O-shaped courtyard perimeter block should assemble into a unified multi-wing complex building');
  for (const w of courtyardBldg.wings ?? []) {
    assert.equal(w.orientationDeg ?? 0, 0, `Courtyard wing must have crisp 0° alignment, got ${w.orientationDeg}`);
  }
  const copperRoof = res.buildings.find((b) => Math.hypot(b.x - 330, b.z - 110) < 25);
  assert.ok(copperRoof, 'Smooth oxidized green/copper roof building should be retained');
  const falseTree = res.buildings.find((b) => Math.hypot(b.x - 335, b.z - 215) < 25);
  assert.equal(falseTree, undefined, 'Noisy uneven green tree canopy must be rejected');
});

test('MAGIC API rails parser & 3D route tracer build curved 3D polylines from /api/rails curvePoints and connectedNodes', () => {
  const rawMagicPayload = {
    rails: [
      {
        id: 'rail-seg-1',
        curvePoints: [
          { x: 0, y: 42, z: 0 },
          { x: 40, y: 46, z: 12 },
          { x: 80, y: 52, z: 40 },
          { x: 100, y: 58, z: 80 },
        ],
        connectedNodes: [{ routes: ['mtr-line-1'] }],
      },
      {
        id: 'rail-seg-2',
        curvePoints: [
          { x: 100, y: 58, z: 80 },
          { x: 120, y: 67, z: 130 },
          { x: 160, y: 74, z: 180 },
          { x: 200, y: 74, z: 200 },
        ],
        connectedNodes: [{ routes: ['mtr-line-1'] }],
      },
      // Unrelated branch rail on another line
      {
        id: 'rail-other',
        curvePoints: [
          { x: 0, y: 42, z: 0 },
          { x: 100, y: 42, z: 200 },
          { x: 200, y: 42, z: 200 },
        ],
        connectedNodes: [{ routes: ['mtr-line-99'] }],
      },
    ],
  };

  const { rails: parsedRails } = parseMagicRailsPayload(rawMagicPayload);
  assert.equal(parsedRails.length, 3);
  assert.equal(extractMagicRailPoints3D(parsedRails[0]).length, 4);
  assert.deepEqual(getRouteIdsForMagicRail(parsedRails[0]), ['mtr-line-1']);

  const metroRoute: MtrRoute = {
    id: 'mtr-line-1',
    name: 'Линия 1',
    shortName: 'M1',
    number: '1',
    color: '#D62828',
    kind: 'metro',
    circular: false,
    stops: [
      { stationId: 's1', name: 'Подземная', x: 2, y: 42, z: 1, dwellMs: 12000 },
      { stationId: 's2', name: 'Эстакадная', x: 198, y: 74, z: 199, dwellMs: 12000 },
    ],
    segmentDurationsMs: [45000],
    headwaySec: 120,
  };

  const traceRes = traceRoutesFromMagicRails([metroRoute], parsedRails, 5);
  assert.equal(traceRes.routesTracedFromMagicRails, 1);
  assert.equal(traceRes.liveVehiclesCount, 5);

  const traced = traceRes.routes[0];
  assert.equal(traced.magicTraced, true);
  assert.equal(traced.magicSmoothed, true);
  assert.ok((traced.magicRailSegments ?? 0) >= 2, 'Should traverse both route-matched rail segments');
  assert.ok((traced.tracedPath3D?.length ?? 0) >= 7, 'Should preserve curved intermediate rail points');

  // Verify it followed rail-seg-1 & rail-seg-2 through (100, 58, 80) instead of unrelated rail-other through (100, 42, 200)
  const hitMidCurve = traced.tracedPath3D!.some(
    (pt) => Math.hypot(pt.x - 100, pt.z - 80) < 5 && Math.abs(pt.y - 58) < 2
  );
  assert.ok(hitMidCurve, 'MAGIC rail tracer must follow route-matched 3D curvePoints');
});

test('decodeTerrainElevationTile decodes 16-bit ground relief and suppresses isolated rooftop spikes', () => {
  const w = 16;
  const h = 32; // top 16 color, bottom 16 height
  const rgba = new Uint8ClampedArray(w * h * 4);

  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      // Smoothly sloping hill from Y=64 on the left to Y=94 on the right
      let y = 64 + px * 2;
      // Add a single-cell sharp rooftop spire at (8,8)
      if (px === 8 && py === 8) y = 140;
      const u16 = y < 0 ? 65536 + y : y;
      const botOff = ((py + 16) * w + px) * 4;
      rgba[botOff] = 0;
      rgba[botOff + 1] = (u16 >> 8) & 0xff;
      rgba[botOff + 2] = u16 & 0xff;
      rgba[botOff + 3] = 255;
    }
  }

  const terrain = decodeTerrainElevationTile(rgba, w, h, 2, -1, 1, 16);
  assert.ok(terrain, 'Terrain tile should decode successfully');
  assert.equal(terrain.worldX, 1000);
  assert.equal(terrain.worldZ, -500);
  assert.ok(terrain.maxY >= 90 && terrain.maxY < 110, `Isolated rooftop spire should be suppressed, got maxY=${terrain.maxY}`);

  const westY = sampleTerrainElevation([terrain], 1030, -250);
  const eastY = sampleTerrainElevation([terrain], 1470, -250);
  assert.ok(eastY > westY + 20, `East hill (${eastY}) should be significantly higher than west lowland (${westY})`);
});

test('Road synthesis excludes wide inner-block open courtyards/plazas while keeping real roads and respecting allowedRoadClasses', () => {
  const grid = voxelize3DObjects(
    [
      // Real 30m highway across the top
      { x: 250, z: 70, width: 420, depth: 30, baseY: 67, topY: 67, material: 'road' },
      // Real 14m regular street along the bottom
      { x: 250, z: 420, width: 420, depth: 14, baseY: 67, topY: 67, material: 'road' },
      // Wide 84x84m paved open courtyard/square inside a block -> MUST NOT be extracted as a road!
      { x: 250, z: 245, width: 84, depth: 84, baseY: 67, topY: 67, material: 'road' },
    ],
    { originX: 0, originZ: 0, widthBlocks: 500, depthBlocks: 500 },
    2,
    67
  );

  const emptyBuildingMask = new Uint8Array(grid.cols * grid.rows);
  const allRoads = extractStreetsWithRealWidth(grid, emptyBuildingMask, 67, {
    minStreetWidthBlocks: 8,
    maxStreetWidthBlocks: 40,
    allowedRoadClasses: ['highway', 'avenue', 'street', 'lane', 'pedestrian'],
  });

  // Ensure the highway & bottom street were found
  assert.ok(
    allRoads.some((s) => s.roadClass === 'highway'),
    'Should detect the 30m highway'
  );
  assert.ok(
    allRoads.some((s) => s.points.some((p) => Math.abs(p.z - 420) < 16)),
    'Should detect the 14m street at z=420'
  );

  // Ensure ZERO roads were erroneously generated inside or along the rim of the 84x84 open courtyard (z in [195..295])
  const courtyardFalseRoads = allRoads.filter((s) =>
    s.points.some((p) => p.x > 195 && p.x < 305 && p.z > 195 && p.z < 295)
  );
  assert.equal(
    courtyardFalseRoads.length,
    0,
    `Wide 84x84m open courtyard must not produce fake roads, got ${courtyardFalseRoads.length}`
  );

  // Verify allowedRoadClasses filtering: highway-only emits only highways
  const highwayOnly = extractStreetsWithRealWidth(grid, emptyBuildingMask, 67, {
    minStreetWidthBlocks: 8,
    maxStreetWidthBlocks: 40,
    allowedRoadClasses: ['highway'],
  });
  assert.ok(highwayOnly.length >= 1, 'Highway-only filter should emit at least 1 highway');
  assert.ok(
    highwayOnly.every((s) => s.roadClass === 'highway'),
    'Highway-only filter must exclude non-highway roads'
  );
});

test('Bidirectional route tracing smoothly connects opposite-direction depot/terminus loops (e.g. T5 at Вакса) and closes circular rings', () => {
  const t5Forward: MtrRoute = {
    id: 't5-vaksa-yaht',
    name: '(Т5) Вакса->Яхтенная',
    shortName: '5',
    number: '5',
    color: '#D92D20',
    kind: 'tram',
    circular: false,
    headwaySec: 240,
    segmentDurationsMs: [30000, 30000, 30000],
    stops: [
      { stationId: 'v-start', name: 'Вакса (посадка)', x: 11231, y: 67, z: -4019, dwellMs: 12000 },
      { stationId: 'm1', name: 'Промзона', x: 11126, y: 67, z: -3862, dwellMs: 12000 },
      { stationId: 'm2', name: 'Береговая', x: 9925, y: 67, z: -3694, dwellMs: 12000 },
      { stationId: 'yaht', name: 'Яхтенная', x: 9260, y: 67, z: -5654, dwellMs: 12000 },
    ],
  };

  const t5Reverse: MtrRoute = {
    id: 't5-yaht-vaksa',
    name: '(Т5) Яхтенная->Вакса',
    shortName: '5',
    number: '5',
    color: '#D92D20',
    kind: 'tram',
    circular: false,
    headwaySec: 240,
    segmentDurationsMs: [30000, 30000, 30000],
    stops: [
      { stationId: 'yaht', name: 'Яхтенная', x: 9260, y: 67, z: -5654, dwellMs: 12000 },
      { stationId: 'm2r', name: 'Береговая', x: 9849, y: 67, z: -3762, dwellMs: 12000 },
      { stationId: 'm1r', name: 'Депо-подход', x: 11442, y: 67, z: -3814, dwellMs: 12000 },
      { stationId: 'v-end', name: 'Вакса (высадка)', x: 11440, y: 67, z: -4019, dwellMs: 12000 },
    ],
  };

  const ringBus: MtrRoute = {
    id: 'bus-k-ring',
    name: 'Автобус||(К) Б.-Конюш. кольцевой (внеш.)',
    shortName: 'К',
    number: 'К',
    color: '#2563EB',
    kind: 'bus',
    circular: false,
    headwaySec: 300,
    segmentDurationsMs: [20000, 20000, 20000, 20000, 20000],
    stops: [
      { stationId: 'k1', name: 'К1', x: 10000, y: 67, z: 0, dwellMs: 10000 },
      { stationId: 'k2', name: 'К2', x: 10600, y: 67, z: 0, dwellMs: 10000 },
      { stationId: 'k3', name: 'К3', x: 10600, y: 67, z: 600, dwellMs: 10000 },
      { stationId: 'k4', name: 'К4', x: 10000, y: 67, z: 600, dwellMs: 10000 },
      { stationId: 'k5', name: 'К5', x: 9900, y: 67, z: 300, dwellMs: 10000 },
      { stationId: 'k6', name: 'К6', x: 9950, y: 67, z: 160, dwellMs: 10000 },
    ],
  };

  const res = traceRoutesFromMagicRails([t5Forward, t5Reverse, ringBus], []);
  const tracedFwd = res.routes.find((r) => r.id === 't5-vaksa-yaht')!;
  const tracedRev = res.routes.find((r) => r.id === 't5-yaht-vaksa')!;
  const tracedRing = res.routes.find((r) => r.id === 'bus-k-ring')!;

  // Reverse T5 ends at (11440, -4019) near depot -> must smoothly curve to Forward T5 start (11231, -4019)
  const revEnd = tracedRev.tracedPath3D![tracedRev.tracedPath3D!.length - 1];
  assert.ok(
    Math.hypot(revEnd.x - 11231, revEnd.z - -4019) < 3,
    `Expected T5 reverse trace to close 209m depot gap to (11231, -4019), got (${revEnd.x}, ${revEnd.z})`
  );
  // Ensure the turnaround loop curves smoothly around the depot (not a sharp single straight jump)
  const loopPts = tracedRev.tracedPath3D!.filter((p) => p.z < -4019.5);
  assert.ok(
    loopPts.length >= 4,
    `Expected curved depot turnaround loop south of z=-4019, got ${loopPts.length} loop points`
  );
  // Original stops & durations must stay intact
  assert.equal(tracedRev.stops.length, 4);
  assert.equal(tracedRev.stops[3].x, 11440);

  // Forward T5 ends at Яхтенная (9260, -5654) where reverse already starts (0m gap) -> stays at Яхтенная
  const fwdEnd = tracedFwd.tracedPath3D![tracedFwd.tracedPath3D!.length - 1];
  assert.ok(
    Math.hypot(fwdEnd.x - 9260, fwdEnd.z - -5654) < 3,
    `Expected T5 forward end to stay at Яхтенная (9260, -5654), got (${fwdEnd.x}, ${fwdEnd.z})`
  );

  // Circular ring bus K (168m gap between last stop and first stop) must close smoothly to first stop
  const ringEnd = tracedRing.tracedPath3D![tracedRing.tracedPath3D!.length - 1];
  assert.ok(
    Math.hypot(ringEnd.x - 10000, ringEnd.z - 0) < 3,
    `Expected circular bus K to close loop back to (10000, 0), got (${ringEnd.x}, ${ringEnd.z})`
  );
});

test('Synthesis rejects elevated bridges over water/roads as buildings', () => {
  const grid = voxelize3DObjects(
    [
      // Wide river crossing the scene vertically (water blue color, below ground)
      { x: 160, z: 160, width: 90, depth: 300, baseY: 62, topY: 62, material: 'water', rgb: [42, 98, 168] },
      // Elevated narrow stone/concrete bridge crossing over the river (14m wide, 140m long, 10m above ground) -> MUST BE REJECTED!
      { x: 160, z: 160, width: 140, depth: 14, baseY: 67, topY: 77, material: 'building', rgb: [132, 134, 138] },
      // Genuine standalone building on the shore -> MUST BE KEPT!
      { x: 55, z: 75, width: 40, depth: 34, baseY: 67, topY: 93, material: 'building', rgb: [175, 118, 96] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 320, depthBlocks: 320 },
    2,
    67
  );
  // Real BlueMap tiles do not have pre-labeled materialTag
  delete grid.materialTag;

  const bRes = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3 });
  assert.equal(bRes.buildings.length, 1, `Should keep 1 shore building and reject river bridge, got ${bRes.buildings.length}`);
  assert.ok(bRes.rejectedBridges >= 1, `Expected rejectedBridges >= 1, got ${bRes.rejectedBridges}`);
  assert.ok(Math.hypot(bRes.buildings[0].x - 55, bRes.buildings[0].z - 75) < 16);
});

test('Closed courtyard block splits touching buildings accurately along roof color and height seams', () => {
  // Two touching row-houses sharing a wall in a closed block: left has terracotta roof (topY=87), right has slate-blue roof (topY=95)
  const grid = voxelize3DObjects(
    [
      { x: 80, z: 100, width: 40, depth: 36, baseY: 67, topY: 87, material: 'building', rgb: [178, 86, 64] },
      { x: 120, z: 100, width: 40, depth: 36, baseY: 67, topY: 95, material: 'building', rgb: [72, 96, 134] },
      // Third touching building at SAME height (87) but completely different roof color (warm yellow vs terracotta)
      { x: 40, z: 100, width: 40, depth: 36, baseY: 67, topY: 87, material: 'building', rgb: [212, 188, 92] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 220, depthBlocks: 200 },
    2,
    67
  );

  const bRes = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3, minBuildingAreaBlocks: 4 });
  assert.equal(
    bRes.buildings.length,
    3,
    `Touching row buildings with distinct roof colors/heights must split into 3 distinct buildings, got ${bRes.buildings.length}`
  );
});

test('Synthesis supports 300-floor skyscrapers and tiny 2x2m kiosks without size restrictions', () => {
  const grid = voxelize3DObjects(
    [
      // 300-floor megatall skyscraper (~1200m above Y=67 -> topY=1267)
      { x: 60, z: 60, width: 32, depth: 32, baseY: 67, topY: 1267, material: 'building', rgb: [148, 166, 182] },
      // Tiny 3x3m kiosk
      { x: 130, z: 60, width: 3, depth: 3, baseY: 67, topY: 73, material: 'building', rgb: [184, 150, 120] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 180, depthBlocks: 120 },
    1,
    67
  );

  const bRes = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3, minBuildingAreaBlocks: 4 });
  assert.equal(bRes.buildings.length, 2, `Should extract both 300-floor skyscraper and tiny 3x3m kiosk, got ${bRes.buildings.length}`);
  const tower = bRes.buildings.find((b) => b.height > 1000);
  assert.ok(tower, 'Must extract 1200m / 300-floor skyscraper without height clamping');
  assert.ok(tower.floors >= 300, `Expected >= 300 floors, got ${tower.floors}`);
  const kiosk = bRes.buildings.find((b) => (b.measuredWidth ?? 99) <= 5);
  assert.ok(kiosk, 'Must extract tiny 3x3m structure');
});

test('Transit road snapping eliminates hairpin vortices near stops and maintains constant-curvature smooth arcs', () => {
  const street: StreetSegment = {
    id: 'st-main',
    name: 'Прямой проспект',
    district: 'Центр',
    roadClass: 'avenue',
    width: 18,
    simAllowed: true,
    points: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 200, z: 0 },
      { x: 300, z: 0 },
      { x: 300, z: 200 },
    ],
  };

  // Stop A slightly past node (100,0) at x=108; Stop B slightly before node (300,0) at x=292; Stop C at (300, 190)
  // Previously snapping could jump backward to node (100,0) then forward, creating a hairpin vortex!
  const bus: MtrRoute = {
    id: 'bus-vortex-check',
    name: 'Автобус 7',
    shortName: '7',
    number: '7',
    color: '#086C14',
    kind: 'bus',
    circular: false,
    headwaySec: 180,
    segmentDurationsMs: [20000, 20000],
    stops: [
      { stationId: 's1', name: 'Ост 1', x: 108, y: 67, z: 6, dwellMs: 10000 },
      { stationId: 's2', name: 'Ост 2', x: 292, y: 67, z: 5, dwellMs: 10000 },
      { stationId: 's3', name: 'Ост 3', x: 296, y: 67, z: 190, dwellMs: 10000 },
    ],
  };

  const traced = tracePublicTransitOverStreets([bus], [street]).tracedRoutes[0];
  const pts = traced.tracedPath ?? [];
  assert.ok(pts.length >= 4);

  // Verify no sharp backward hairpin reversals (< -0.7 dot product between consecutive edges)
  for (let i = 1; i < pts.length - 1; i++) {
    const ux = pts[i].x - pts[i - 1].x;
    const uz = pts[i].z - pts[i - 1].z;
    const vx = pts[i + 1].x - pts[i].x;
    const vz = pts[i + 1].z - pts[i].z;
    const lu = Math.hypot(ux, uz);
    const lv = Math.hypot(vx, vz);
    if (lu < 0.5 || lv < 0.5) continue;
    const cos = (ux * vx + uz * vz) / (lu * lv);
    assert.ok(cos > -0.65, `Detected hairpin vortex at vertex ${i}: cos=${cos.toFixed(3)}`);
  }
});

test('Synthesis extracts more than 900 buildings without artificial count cap', () => {
  // 35 x 30 = 1,050 detached buildings arranged in a clean city grid
  const objects = [];
  for (let gx = 0; gx < 35; gx++) {
    for (let gz = 0; gz < 30; gz++) {
      objects.push({
        x: 20 + gx * 20,
        z: 20 + gz * 20,
        width: 10,
        depth: 10,
        baseY: 67,
        topY: 82,
        material: 'building' as const,
        rgb: [185, 165, 145] as [number, number, number],
      });
    }
  }
  const grid = voxelize3DObjects(
    objects,
    { originX: 0, originZ: 0, widthBlocks: 740, depthBlocks: 640 },
    2,
    67
  );

  const res = runUrbanSynthesisPipeline(
    [grid],
    [],
    [],
    [],
    { targetMode: 'buildings', minBuildingHeight: 3, minBuildingAreaBlocks: 4, maxBuildingsPerRun: 0 },
    'procedural-3d'
  );
  assert.equal(
    res.buildings.length,
    1050,
    `Expected all 1050 buildings without 900-building cap, got ${res.buildings.length}`
  );
  assert.equal(res.stats.buildingsExtracted, 1050);
});

test('Angular (L-shaped, П-shaped) buildings decompose into crisp 0° multi-wing compound structures with zero tilt', () => {
  const grid = voxelize3DObjects(
    [
      // L-shaped corner building (like 71+55 / 43+4 in user screenshot)
      { x: 50, z: 60, width: 16, depth: 44, baseY: 67, topY: 85, material: 'building', rgb: [168, 166, 160] },
      { x: 74, z: 74, width: 32, depth: 16, baseY: 67, topY: 85, material: 'building', rgb: [168, 166, 160] },
      // П-shaped (U-shaped) residential building
      { x: 170, z: 46, width: 64, depth: 14, baseY: 67, topY: 88, material: 'building', rgb: [152, 148, 142] },
      { x: 145, z: 68, width: 14, depth: 30, baseY: 67, topY: 88, material: 'building', rgb: [152, 148, 142] },
      { x: 195, z: 68, width: 14, depth: 30, baseY: 67, topY: 88, material: 'building', rgb: [152, 148, 142] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 250, depthBlocks: 130 },
    2,
    67
  );

  const res = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3, minBuildingAreaBlocks: 4 });
  assert.equal(res.buildings.length, 2, `Should produce 2 unified complex buildings (L + П), got ${res.buildings.length}`);

  const lBldg = res.buildings.find((b) => b.x < 110);
  assert.ok(lBldg, 'Should extract L-shaped building');
  assert.equal(lBldg.wings?.length, 2, `L-shaped building should have exactly 2 clean wings, got ${lBldg.wings?.length}`);
  for (const w of lBldg.wings ?? []) {
    assert.equal(w.orientationDeg, 0, `Every wing of axis-aligned L-building must have exact 0° angle, got ${w.orientationDeg}`);
  }

  const uBldg = res.buildings.find((b) => b.x >= 110);
  assert.ok(uBldg, 'Should extract П-shaped building');
  assert.equal(uBldg.wings?.length, 3, `П-shaped building should have exactly 3 clean wings, got ${uBldg.wings?.length}`);
  for (const w of uBldg.wings ?? []) {
    assert.equal(w.orientationDeg, 0, `Every wing of axis-aligned П-building must have exact 0° angle, got ${w.orientationDeg}`);
  }
});

test('Diagonal 45° corner building and bent (0° + 45°) complex building generate crisp aligned wings', () => {
  const grid = voxelize3DObjects(
    [
      // 45°-rotated diagonal L-shaped building (two perpendicular 45°/135° wings)
      { x: 80, z: 80, width: 48, depth: 16, angleDeg: 45, baseY: 67, topY: 89, material: 'building', rgb: [176, 152, 134] },
      { x: 80 + 11.3, z: 80 - 11.3, width: 16, depth: 44, angleDeg: 45, baseY: 67, topY: 89, material: 'building', rgb: [176, 152, 134] },
      // Bent diagonal building: horizontal 0° wing + angled 45° wing joined at a corner
      { x: 185, z: 70, width: 46, depth: 14, angleDeg: 0, baseY: 67, topY: 86, material: 'building', rgb: [148, 160, 174] },
      { x: 220, z: 86, width: 42, depth: 14, angleDeg: 45, baseY: 67, topY: 86, material: 'building', rgb: [148, 160, 174] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 280, depthBlocks: 160 },
    2,
    67
  );

  const res = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3, minBuildingAreaBlocks: 4 });
  assert.equal(res.buildings.length, 2, `Should extract 2 compound diagonal buildings, got ${res.buildings.length}`);

  const diagL = res.buildings.find((b) => b.x < 140);
  assert.ok(diagL && (diagL.wings?.length ?? 0) >= 2, 'Diagonal 45° L-building should decompose into >= 2 crisp wings');
  for (const w of diagL.wings ?? []) {
    assert.ok(
      Math.abs((w.orientationDeg ?? 0) - 45) <= 2,
      `Diagonal L-wing should snap cleanly to 45°, got ${w.orientationDeg}`
    );
  }

  const bent = res.buildings.find((b) => b.x >= 140);
  assert.ok(bent && (bent.wings?.length ?? 0) >= 2, 'Bent 0°+45° building should decompose into >= 2 wings');
  const angles = (bent.wings ?? []).map((w) => w.orientationDeg ?? 0);
  assert.ok(
    angles.some((a) => a <= 3),
    `Bent building must preserve crisp 0° horizontal wing, got angles: ${angles.join(', ')}`
  );
  assert.ok(
    angles.some((a) => Math.abs(a - 45) <= 6),
    `Bent building must preserve crisp ~45° diagonal wing, got angles: ${angles.join(', ')}`
  );
});

test('Circular and oval buildings synthesize as smooth round polygons without misclassifying squares', () => {
  const grid = voxelize3DObjects(
    [
      // Round cylindrical tower / rotunda (Ø36m)
      { x: 60, z: 70, width: 36, depth: 36, shape: 'circle', baseY: 67, topY: 105, material: 'building', rgb: [188, 174, 152] },
      // Oval stadium / circus pavilion (46 x 30m)
      { x: 145, z: 70, width: 46, depth: 30, shape: 'circle', baseY: 67, topY: 92, material: 'building', rgb: [164, 172, 182] },
      // Regular 0° square building (must stay rectangular!)
      { x: 60, z: 150, width: 30, depth: 30, shape: 'rect', angleDeg: 0, baseY: 67, topY: 88, material: 'building', rgb: [174, 150, 140] },
      // Regular 45°-rotated square building (must stay rectangular at 45°, NOT circular!)
      { x: 145, z: 150, width: 30, depth: 30, shape: 'rect', angleDeg: 45, baseY: 67, topY: 88, material: 'building', rgb: [160, 160, 160] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 220, depthBlocks: 210 },
    2,
    67
  );

  const res = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3, minBuildingAreaBlocks: 4 });
  assert.equal(res.buildings.length, 4, `Should extract all 4 buildings, got ${res.buildings.length}`);

  const roundTower = res.buildings.find((b) => Math.hypot(b.x - 60, b.z - 70) < 12);
  assert.ok(roundTower, 'Should extract round tower');
  assert.equal(roundTower.shapeType, 'circular', `Round tower must be classified as circular, got ${roundTower.shapeType}`);
  assert.ok(roundTower.footprint.length >= 20, `Circular building must have smooth >=20-vertex polygon, got ${roundTower.footprint.length}`);

  const ovalPavilion = res.buildings.find((b) => Math.hypot(b.x - 145, b.z - 70) < 12);
  assert.ok(ovalPavilion, 'Should extract oval pavilion');
  assert.equal(ovalPavilion.shapeType, 'circular', `Oval pavilion must be classified as circular, got ${ovalPavilion.shapeType}`);
  assert.ok(ovalPavilion.footprint.length >= 20, `Oval building must have smooth >=20-vertex polygon, got ${ovalPavilion.footprint.length}`);

  const square0 = res.buildings.find((b) => Math.hypot(b.x - 60, b.z - 150) < 12);
  assert.ok(square0, 'Should extract 0° square');
  assert.notEqual(square0.shapeType, 'circular', '0° square must NOT be misclassified as circular');
  assert.equal(square0.footprint.length, 4);
  assert.equal(square0.orientationDeg, 0);

  const square45 = res.buildings.find((b) => Math.hypot(b.x - 145, b.z - 150) < 12);
  assert.ok(square45, 'Should extract 45° square');
  assert.notEqual(square45.shapeType, 'circular', '45° square must NOT be misclassified as circular');
  assert.equal(square45.footprint.length, 4);
  assert.equal(square45.orientationDeg, 45);
});

test('Elongated apartment blocks bordered by light-gray concrete sidewalks are preserved (not falsely rejected as bridges)', () => {
  // Reproduces the top half of the user screenshot: 68x16m residential panel blocks surrounded by gray concrete paving
  const grid = voxelize3DObjects(
    [
      // Concrete courtyard paving (light gray, lum ~ 142) at groundY=67
      { x: 100, z: 70, width: 150, depth: 90, baseY: 67, topY: 67, material: 'building', rgb: [142, 144, 146] },
      // Elongated 5-story apartment building (68x16m, dark gray roof)
      { x: 100, z: 70, width: 68, depth: 16, baseY: 67, topY: 85, material: 'building', rgb: [92, 92, 92] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 200, depthBlocks: 140 },
    2,
    67
  );
  // Clear materialTag so RGB classifier runs identically to live BlueMap tiles
  grid.materialTag = undefined;

  const res = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3, minBuildingAreaBlocks: 4 });
  assert.equal(res.buildings.length, 1, `Sidewalk-flanked apartment block must be extracted (not rejected as bridge), got ${res.buildings.length}`);
  assert.equal(res.rejectedBridges, 0);
  assert.equal(res.buildings[0].orientationDeg, 0);
});

test('Diagonal buildings (25°, 35°, 45°) synthesize as clean rotated single buildings instead of 0° square staircases', () => {
  const grid = voxelize3DObjects(
    [
      { x: 60, z: 60, width: 42, depth: 14, angleDeg: 25, baseY: 67, topY: 88, material: 'building', rgb: [165, 152, 140] },
      { x: 155, z: 65, width: 46, depth: 16, angleDeg: 35, baseY: 67, topY: 92, material: 'building', rgb: [148, 160, 174] },
      { x: 105, z: 145, width: 44, depth: 16, angleDeg: 45, baseY: 67, topY: 86, material: 'building', rgb: [176, 146, 134] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 220, depthBlocks: 200 },
    2,
    67
  );

  const res = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3, minBuildingAreaBlocks: 4 });
  assert.equal(res.buildings.length, 3, `Expected exactly 3 diagonal buildings, got ${res.buildings.length}`);

  const b25 = res.buildings.find((b) => Math.hypot(b.x - 60, b.z - 60) < 12);
  const b35 = res.buildings.find((b) => Math.hypot(b.x - 155, b.z - 65) < 12);
  const b45 = res.buildings.find((b) => Math.hypot(b.x - 105, b.z - 145) < 12);
  assert.ok(b25 && b35 && b45, 'All 3 diagonal buildings must be found');

  for (const [label, b, expected] of [
    ['25°', b25, 25],
    ['35°', b35, 35],
    ['45°', b45, 45],
  ] as const) {
    assert.ok(
      !b.wings || b.wings.length <= 1,
      `Diagonal ${label} rectangular building must NOT fracture into multiple square wings (got ${b.wings?.length ?? 1})`
    );
    const angleDiff = Math.min(
      Math.abs((b.orientationDeg ?? 0) - expected),
      Math.abs(Math.abs((b.orientationDeg ?? 0) - expected) - 90)
    );
    assert.ok(
      angleDiff <= 8,
      `Diagonal ${label} building must keep its rotated orientation (~${expected}°), got ${b.orientationDeg}°`
    );
  }
});

test('Single building with contrasting parapet rim, rooftop HVAC box, or skylight stays 1 unified building', () => {
  const grid = voxelize3DObjects(
    [
      // Main 54x20m residential block with dark gray roof at Y=86
      { x: 100, z: 80, width: 54, depth: 20, baseY: 67, topY: 86, material: 'building', rgb: [96, 98, 102] },
      // Contrasting white stone parapet border strip along one side (1 block higher, bright white!)
      { x: 100, z: 71, width: 54, depth: 2, baseY: 67, topY: 87, material: 'building', rgb: [218, 218, 214] },
      { x: 100, z: 89, width: 54, depth: 2, baseY: 67, topY: 87, material: 'building', rgb: [218, 218, 214] },
      // Embedded rooftop technical penthouse / skylight box inside the roof (4m taller, lighter metal)
      { x: 96, z: 80, width: 10, depth: 6, baseY: 86, topY: 91, material: 'building', rgb: [182, 188, 196] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 200, depthBlocks: 160 },
    2,
    67
  );

  const res = extractBuildingsFrom3DGrid(grid, [], { minBuildingHeight: 3, minBuildingAreaBlocks: 4 });
  assert.equal(
    res.buildings.length,
    1,
    `Building with parapet trim & rooftop mechanical box must stay 1 unified building, got ${res.buildings.length}`
  );
  assert.ok((res.buildings[0].measuredWidth ?? 0) >= 48, 'Unified building must retain full 54m span');
});

test('Arbitrary non-rectangular cropPolygon strictly clips buildings & roads outside the polygon even inside its AABB', () => {
  const grid = voxelize3DObjects(
    [
      // Inside triangular polygon (bottom-left half of AABB)
      { x: 45, z: 120, width: 18, depth: 18, baseY: 67, topY: 88, material: 'building', rgb: [175, 155, 140] },
      // Inside AABB (0..160 x 0..160) but OUTSIDE the triangle (top-right corner!)
      { x: 135, z: 35, width: 18, depth: 18, baseY: 67, topY: 88, material: 'building', rgb: [175, 155, 140] },
    ],
    { originX: 0, originZ: 0, widthBlocks: 170, depthBlocks: 170 },
    2,
    67
  );

  // Right-triangle zone covering bottom-left: (10,10) -> (10,155) -> (155,155)
  const trianglePoly = [
    { x: 10, z: 10 },
    { x: 10, z: 155 },
    { x: 155, z: 155 },
  ];

  const res = extractBuildingsFrom3DGrid(grid, [], {
    minBuildingHeight: 3,
    minBuildingAreaBlocks: 4,
    cropPolygon: trianglePoly,
  });
  assert.equal(
    res.buildings.length,
    1,
    `Triangle cropPolygon must include only the building inside the triangle (not the AABB corner), got ${res.buildings.length}`
  );
  assert.ok(Math.hypot(res.buildings[0].x - 45, res.buildings[0].z - 120) < 10);
});

test('Multi-block variegated roofs (terracotta + blue stone + light trim, real BlueMap mode) synthesize as 1 unified building without shattering', () => {
  // Reproduces screenshot #2: a large building whose flat roof is built from mixed blue/purple stone,
  // terracotta stripes, and a pale stone trim border with materialTag undefined (real BlueMap tile)
  const cols = 100;
  const rows = 90;
  const heights = new Float32Array(cols * rows).fill(67);
  const rgb = new Uint8Array(cols * rows * 3);
  for (let i = 0; i < cols * rows; i++) {
    rgb[i * 3] = 112;
    rgb[i * 3 + 1] = 115;
    rgb[i * 3 + 2] = 118;
  }

  // Paint a 48x30m building (gx in [26..73], gz in [30..59]) at Y=89 (22m tall)
  for (let gz = 30; gz < 60; gz++) {
    for (let gx = 26; gx < 74; gx++) {
      const idx = gz * cols + gx;
      const isBorder = gx === 26 || gx === 73 || gz === 30 || gz === 59;
      const isTerracottaStripe = (gx - 26) % 7 === 3 && gz >= 35 && gz <= 54;
      const isBlueStoneChecker = ((gx * 3 + gz * 5) & 3) === 0;
      heights[idx] = isBorder ? 90 : 89;
      if (isBorder) {
        // Pale stone cornice trim
        rgb[idx * 3] = 212;
        rgb[idx * 3 + 1] = 206;
        rgb[idx * 3 + 2] = 186;
      } else if (isTerracottaStripe) {
        // Warm terracotta / brown skylight stripe
        rgb[idx * 3] = 176;
        rgb[idx * 3 + 1] = 98;
        rgb[idx * 3 + 2] = 74;
      } else if (isBlueStoneChecker) {
        // Slate-blue stone (b > r + 18 && b > g + 8 && r < 105 -> must NOT be rejected as water at roof height!)
        rgb[idx * 3] = 72;
        rgb[idx * 3 + 1] = 94;
        rgb[idx * 3 + 2] = 136;
      } else {
        // Purple-gray / slate-blue terracotta base
        rgb[idx * 3] = 106;
        rgb[idx * 3 + 1] = 104;
        rgb[idx * 3 + 2] = 132;
      }
    }
  }

  const grid = {
    originX: 0,
    originZ: 0,
    cols,
    rows,
    cellSize: 1,
    heights,
    rgb,
  };

  const res = extractBuildingsFrom3DGrid(grid, [], {
    minBuildingHeight: 3,
    minBuildingAreaBlocks: 4,
  });

  assert.equal(
    res.buildings.length,
    1,
    `Variegated terracotta + blue-stone roof must synthesize as 1 unified building, got ${res.buildings.length}`
  );
  assert.ok(
    (res.buildings[0].measuredWidth ?? 0) >= 42 && (res.buildings[0].measuredDepth ?? 0) >= 24,
    `Expected unified ~48x30m building, got ${res.buildings[0].measuredWidth}x${res.buildings[0].measuredDepth}m`
  );
});




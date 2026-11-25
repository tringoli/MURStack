import test from 'node:test';
import assert from 'node:assert/strict';
import type { Building3D, LandFeature, MapPoi, MtrRoute, MtrStation, StreetSegment } from '../types/map';
import {
  isMuromorskMetroRoute,
  isMuromorskMetroStation,
  MUROMORSK_WIKI_COLORS,
  resolveMuromorskTransitColor,
} from './mursTransitBrand';
import { searchMapEntities } from './smartSearch';
import {
  computeTerritoryLabelPlacement,
  getRoadHierarchyLevel,
  integrateStreetWithAutoIntersections,
  pointInScreenPolygon,
  SERVER_GROUND_Y,
  snapBuildingRectToNeighbors,
  snapBuildingRectToStreet,
  snapPointToBuildings,
  snapPointToLandFeatures,
  snapRoadPointToNetwork,
} from './geometry';
import {
  buildClippedPolylinePathCommands,
  buildLandSpatialIndex,
  computeLandExposedEdges,
} from './spatialIndex';
import {
  autoAddressBuildingsForStreet,
  autoAddressNewBuilding,
} from './houseNumbering';
import {
  computeBuildingLabelAnchor,
  computeWingExposedEdges,
  convertWingToFreeform,
  detectParallelogramSkewFromFootprint,
  detectTriangleCornerFromFootprint,
  insertBuildingWingVertex,
  mergeMultipleBuildings,
  moveBuilding,
  moveBuildingWingVertex,
  getBuildingWings,
  removeBuildingWingVertex,
  resizeBuildingWingCorner,
  rotateBuilding,
} from './buildingOps';
import {
  createParallelogramFootprint,
  createRectFootprint,
  createTriangleFootprint,
} from './projection';
import {
  buildStationCombinedModesMap,
  resolveStationStopSymbol,
} from './transitStopIcons';
import { computeStreetRoute } from './routing';
import {
  parseMagicRailsPayload,
  smoothMagicBlockExact3D,
  traceRoutesFromMagicRails,
} from './magicTracks';
import {
  runUrbanSynthesisPipeline,
  voxelize3DObjects,
  type HeightColorGrid,
} from './urbanSynthesizer';
import {
  buildRegionalSettlements,
  clampMapZoom,
  computeMapZoomOpacity,
  getMapZoomLod,
  MAX_MAP_ZOOM,
  mergeMapPlaces,
  MIN_MAP_ZOOM,
  smoothBand,
  smoothstep,
} from './mapZoomLod';
import {
  clipPolygonToHalfPlane,
  computeFacadeSolarIntensity,
  computeShadowOffset,
  computeSolarPosition,
  computeWallShadowPolygons,
  computeWingShadowGeometry,
  ensureScreenPolygonCW,
  KALININGRAD_GEO,
} from './solarInsolation';

test('Official MURS Wiki transit colors & Muromorsk metro station detection', () => {
  const center = { x: 10550, z: -620 };
  assert.equal(
    resolveMuromorskTransitColor('metro', 'Невско-Заводская линия', 'М1', '#000000', center),
    MUROMORSK_WIKI_COLORS.m1
  );
  assert.equal(
    resolveMuromorskTransitColor('metro', 'Марининско-Павловская линия', 'М2', '#000000', center),
    MUROMORSK_WIKI_COLORS.m2
  );
  assert.equal(
    resolveMuromorskTransitColor('metro', 'Замуррецкая линия', 'М3', '#000000', center),
    MUROMORSK_WIKI_COLORS.m3
  );
  assert.equal(
    resolveMuromorskTransitColor('metro', 'Калининско-Мурская линия', 'М4', '#000000', center),
    MUROMORSK_WIKI_COLORS.m4
  );
  assert.equal(
    resolveMuromorskTransitColor('rail', 'Северное направление', 'Св', '#000000', center),
    MUROMORSK_WIKI_COLORS.railNorth
  );
  assert.equal(
    resolveMuromorskTransitColor('rail', 'Восточное направление', 'Вв', '#000000', center),
    MUROMORSK_WIKI_COLORS.railEast
  );
  assert.equal(
    resolveMuromorskTransitColor('tram', 'Трамвай №3', 'Т3', '#000000', center),
    MUROMORSK_WIKI_COLORS.tram
  );
  assert.equal(
    resolveMuromorskTransitColor('trolleybus', 'Троллейбус №5', 'Тр5', '#000000', center),
    MUROMORSK_WIKI_COLORS.trolleybus
  );
  assert.equal(
    resolveMuromorskTransitColor('bus', 'Автобус №53', 'А53', '#000000', center),
    MUROMORSK_WIKI_COLORS.bus
  );

  // Non-Muromorsk city coordinate keeps original server color & is not flagged as Muromorsk metro
  const foreignColor = resolveMuromorskTransitColor(
    'metro',
    'Красноградская линия 1',
    'М1',
    '#ABCDEF',
    { x: -12000, z: 18000 }
  );
  assert.equal(foreignColor, '#ABCDEF');

  const muromorskMetro: MtrStation = {
    id: 'st-m1',
    name: 'Площадь Свободы',
    x: 10550,
    y: 45,
    z: -620,
    color: MUROMORSK_WIKI_COLORS.m1,
    kinds: ['metro'],
    routeIds: ['r1'],
    district: 'Муроморск',
  };
  const foreignMetro: MtrStation = {
    id: 'st-other',
    name: 'Красноград-Центр',
    x: -12000,
    y: 45,
    z: 18000,
    color: '#ABCDEF',
    kinds: ['metro'],
    routeIds: ['r2'],
    district: 'Красноградск',
  };
  assert.equal(isMuromorskMetroStation(muromorskMetro), true);
  assert.equal(isMuromorskMetroStation(foreignMetro), false);
});

test('Smart search finds buildings & POIs by abbreviations, keywords, and addresses', () => {
  const buildings: Building3D[] = [
    {
      id: 'b-vokzal',
      name: 'Муроморск-Главный',
      street: 'Привокзальная площадь',
      houseNumber: '1',
      district: 'Железнодорожный район',
      category: 'transport',
      icon: 'station',
      x: 10400,
      z: -500,
      footprint: createRectFootprint(10400, -500, 80, 40, 0),
      floors: 3,
      height: 16,
    },
    {
      id: 'b-lib',
      name: 'Городская читальня им. А. С. Пушкина',
      street: 'Морской бульвар',
      houseNumber: '14А',
      district: 'Муроморск',
      category: 'culture',
      icon: 'library',
      x: 10600,
      z: -620,
      footprint: createRectFootprint(10600, -620, 40, 30, 0),
      floors: 4,
      height: 19,
    },
    {
      id: 'b-mall',
      name: 'Галерея «Мур»',
      street: 'Оборонная улица',
      houseNumber: '32',
      district: 'Муроморск',
      category: 'commercial',
      icon: 'shop',
      x: 10800,
      z: -700,
      footprint: createRectFootprint(10800, -700, 60, 50, 0),
      floors: 3,
      height: 15,
    },
  ];

  const pois: MapPoi[] = [
    {
      id: 'poi-monument',
      name: 'Стела Основателям',
      icon: 'monument',
      x: 10550,
      z: -600,
    },
    {
      id: 'poi-cafe',
      name: 'Кофейня «Бриз»',
      icon: 'cafe',
      x: 10810,
      z: -705,
    },
  ];

  // Keyword "вокзал" & abbreviation "жд" find transport building
  const rVokzal = searchMapEntities('вокзал', { stations: [], buildings, streets: [], pois });
  assert.equal(rVokzal[0]?.entity.type, 'building');
  assert.equal(rVokzal[0]?.entity.type === 'building' && rVokzal[0].entity.data.id, 'b-vokzal');

  const rJd = searchMapEntities('жд', { stations: [], buildings, streets: [], pois });
  assert.ok(rJd.some((r) => r.entity.type === 'building' && r.entity.data.id === 'b-vokzal'));

  // Keyword "библиотека" & short prefix "библ" find the library building
  const rLib = searchMapEntities('библиотека', { stations: [], buildings, streets: [], pois });
  assert.ok(rLib.some((r) => r.entity.type === 'building' && r.entity.data.id === 'b-lib'));

  // Abbreviation "тц" finds the commercial mall building
  const rTc = searchMapEntities('тц', { stations: [], buildings, streets: [], pois });
  assert.ok(rTc.some((r) => r.entity.type === 'building' && r.entity.data.id === 'b-mall'));

  // Street + house number search works
  const rAddr = searchMapEntities('Оборонная 32', { stations: [], buildings, streets: [], pois });
  assert.equal(rAddr[0]?.entity.type === 'building' && rAddr[0].entity.data.id, 'b-mall');

  // Standalone POI search by keyword "памятник" & "кафе"
  const rMon = searchMapEntities('памятник', { stations: [], buildings, streets: [], pois });
  assert.equal(rMon[0]?.entity.type, 'poi');
  assert.equal(rMon[0]?.entity.type === 'poi' && rMon[0].entity.data.id, 'poi-monument');
});

test('Road snapping at arbitrary angles & automatic intersections respect elevation', () => {
  const existingRoad: StreetSegment = {
    id: 'st-horiz',
    name: 'Горизонтальный проспект',
    district: 'Муроморск',
    roadClass: 'avenue',
    width: 16,
    elevationY: SERVER_GROUND_Y,
    simAllowed: true,
    points: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
    ],
  };

  // Snap to segment midpoint at an arbitrary branching position
  const snap = snapRoadPointToNetwork({ x: 42, z: 4 }, [existingRoad], SERVER_GROUND_Y, 12);
  assert.equal(snap.snapped, true);
  assert.equal(snap.snapKind, 'edge');
  assert.equal(snap.x, 42);
  assert.equal(snap.z, 0);

  // Diagonal road crossing existingRoad at ground level creates shared auto-intersection node
  const crossingRoad: StreetSegment = {
    id: 'st-diag',
    name: 'Диагональный проезд',
    district: 'Муроморск',
    roadClass: 'street',
    width: 12,
    elevationY: SERVER_GROUND_Y,
    simAllowed: true,
    points: [
      { x: 20, z: -40 },
      { x: 80, z: 40 },
    ],
  };

  const resGround = integrateStreetWithAutoIntersections(crossingRoad, [existingRoad]);
  assert.equal(resGround.intersections.length, 1);
  assert.equal(resGround.intersections[0].x, 50);
  assert.equal(resGround.intersections[0].z, 0);
  // Both new road and existing road received the shared intersection vertex (50, 0)
  assert.ok(resGround.street.points.some((p) => p.x === 50 && p.z === 0));
  assert.equal(resGround.updatedExistingStreets.length, 1);
  assert.ok(resGround.updatedExistingStreets[0].points.some((p) => p.x === 50 && p.z === 0));

  // Elevated overpass bridge (+8m above ground) does NOT create a flat intersection!
  const overpassRoad: StreetSegment = {
    ...crossingRoad,
    id: 'st-bridge',
    elevationY: SERVER_GROUND_Y + 8,
  };
  const resBridge = integrateStreetWithAutoIntersections(overpassRoad, [existingRoad]);
  assert.equal(resBridge.intersections.length, 0);
  assert.equal(resBridge.updatedExistingStreets.length, 0);
});

test('Building-to-building flush snapping removes gaps & multi-building merge combines 3+ buildings', () => {
  const b1: Building3D = {
    id: 'b1',
    name: 'Корпус 1',
    street: 'Невская улица',
    houseNumber: '10',
    district: 'Муроморск',
    category: 'residential',
    x: 100,
    z: 100,
    footprint: createRectFootprint(100, 100, 40, 20, 0), // X: [80..120], Z: [90..110]
    measuredWidth: 40,
    measuredDepth: 20,
    orientationDeg: 0,
    floors: 5,
    height: 24,
  };

  // Candidate placed 3m to the right of b1 (left edge at 123 vs b1 right edge at 120)
  const candidate = {
    x: 143,
    z: 100,
    width: 40,
    depth: 20,
    angleDeg: 0,
    footprint: createRectFootprint(143, 100, 40, 20, 0),
    snapped: false,
  };
  const snapped = snapBuildingRectToNeighbors(candidate, [b1], undefined, 10);
  assert.equal(snapped.snappedToBuildingId, 'b1');
  const minX = Math.min(...snapped.footprint.map((p) => p.x));
  // Gap must be strictly 0 (minX === 120)!
  assert.ok(Math.abs(minX - 120) < 0.01, `Expected flush minX=120, got ${minX}`);

  // Merge 3 buildings together via mergeMultipleBuildings
  const b2: Building3D = {
    ...b1,
    id: 'b2',
    name: 'Корпус 2',
    x: 140,
    z: 100,
    footprint: createRectFootprint(140, 100, 40, 20, 0),
  };
  const b3: Building3D = {
    ...b1,
    id: 'b3',
    name: 'Корпус 3',
    x: 140,
    z: 120,
    footprint: createRectFootprint(140, 120, 40, 20, 0),
  };

  const merged = mergeMultipleBuildings([b1, b2, b3]);
  assert.equal(merged.id, 'b1');
  assert.equal(merged.street, 'Невская улица');
  assert.equal(merged.houseNumber, '10');
  assert.equal(getBuildingWings(merged).length, 3);
});

test('Transit stop symbols detect bus, tram, trolleybus, rail, metro, bus+tram, rail+metro & preserve Muromorsk Metro', () => {
  const busStop: MtrStation = {
    id: 'st-bus',
    name: 'Площадь Победы',
    x: 10500,
    y: 64,
    z: -600,
    color: MUROMORSK_WIKI_COLORS.bus,
    kinds: ['bus'],
    routeIds: ['b1'],
    district: 'Муроморск',
  };
  const tramStopNearBus: MtrStation = {
    id: 'st-tram',
    name: 'Площадь Победы (трам.)',
    x: 10512,
    y: 64,
    z: -605,
    color: MUROMORSK_WIKI_COLORS.tram,
    kinds: ['tram'],
    routeIds: ['t1'],
    district: 'Муроморск',
  };
  const trolleyStop: MtrStation = {
    id: 'st-trol',
    name: 'Морской бульвар',
    x: 10900,
    y: 64,
    z: -600,
    color: MUROMORSK_WIKI_COLORS.trolleybus,
    kinds: ['trolleybus'],
    routeIds: ['tr1'],
    district: 'Муроморск',
  };
  const muromorskMetro: MtrStation = {
    id: 'st-mm',
    name: 'Вокзальная',
    x: 10400,
    y: 45,
    z: -500,
    color: MUROMORSK_WIKI_COLORS.m1,
    kinds: ['metro'],
    routeIds: ['m1'],
    district: 'Муроморск',
  };
  const nearbyRail: MtrStation = {
    id: 'st-rail',
    name: 'Муроморск-Главный',
    x: 10420,
    y: 64,
    z: -510,
    color: MUROMORSK_WIKI_COLORS.railNorth,
    kinds: ['rail'],
    routeIds: ['r1'],
    district: 'Муроморск',
  };
  const foreignMetro: MtrStation = {
    id: 'st-f-metro',
    name: 'Северная',
    x: -15000,
    y: 48,
    z: 15000,
    color: '#0078BF',
    kinds: ['metro', 'rail'],
    routeIds: ['fm1', 'fr1'],
    district: 'Красноградск',
  };

  const combinedMap = buildStationCombinedModesMap([
    busStop,
    tramStopNearBus,
    trolleyStop,
    muromorskMetro,
    nearbyRail,
    foreignMetro,
  ]);

  assert.equal(resolveStationStopSymbol(busStop, combinedMap.get(busStop.id)).symbol, 'bus-tram');
  assert.equal(resolveStationStopSymbol(trolleyStop, combinedMap.get(trolleyStop.id)).symbol, 'trolleybus');
  // Unique Muromorsk Metro emblem is preserved (paired with Rail at interchange hub)
  assert.equal(resolveStationStopSymbol(muromorskMetro).symbol, 'muromorsk-metro');
  assert.equal(
    resolveStationStopSymbol(muromorskMetro, combinedMap.get(muromorskMetro.id)).symbol,
    'muromorsk-metro-rail'
  );
  assert.equal(resolveStationStopSymbol(nearbyRail).symbol, 'rail');
  // Non-Muromorsk combined rail+metro uses generic rail-metro hub symbol
  assert.equal(resolveStationStopSymbol(foreignMetro).symbol, 'rail-metro');
});

test('One-way traffic enforcement in car routing and service/dirt road hierarchy', () => {
  assert.ok(getRoadHierarchyLevel('dirt') < getRoadHierarchyLevel('service'));
  assert.ok(getRoadHierarchyLevel('service') < getRoadHierarchyLevel('lane'));
  assert.ok(getRoadHierarchyLevel('lane') < getRoadHierarchyLevel('street'));
  assert.ok(getRoadHierarchyLevel('street') < getRoadHierarchyLevel('highway'));

  // Direct one-way street from X=0 -> X=100, plus a longer two-way detour at Z=60
  const oneWayDirect: StreetSegment = {
    id: 'st-ow',
    name: 'Односторонний проезд',
    district: 'Муроморск',
    roadClass: 'service',
    width: 6,
    oneWay: 'forward',
    simAllowed: true,
    points: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
    ],
  };
  const detour: StreetSegment = {
    id: 'st-detour',
    name: 'Объездная грунтовка',
    district: 'Муроморск',
    roadClass: 'dirt',
    width: 6,
    oneWay: 'none',
    simAllowed: true,
    points: [
      { x: 0, z: 0 },
      { x: 0, z: 60 },
      { x: 100, z: 60 },
      { x: 100, z: 0 },
    ],
  };

  const forwardAuto = computeStreetRoute(
    { label: 'A', x: 0, z: 0 },
    { label: 'B', x: 100, z: 0 },
    [oneWayDirect, detour],
    'auto'
  );
  const reverseAuto = computeStreetRoute(
    { label: 'B', x: 100, z: 0 },
    { label: 'A', x: 0, z: 0 },
    [oneWayDirect, detour],
    'auto'
  );
  assert.ok(forwardAuto && reverseAuto);
  // Driving with the one-way direction takes the 100m direct road; driving against it MUST detour (~220m)
  assert.ok(
    forwardAuto.totalDistanceBlocks < 130,
    `Expected direct forward route ~100m, got ${forwardAuto.totalDistanceBlocks}`
  );
  assert.ok(
    reverseAuto.totalDistanceBlocks > 180,
    `Expected reverse car route to detour around one-way street, got ${reverseAuto.totalDistanceBlocks}`
  );
});

test('MAGIC API block-for-block rail tracing with bounded smoothing and switch heading continuity', () => {
  // Build a Y-junction where a straight main track runs (0,0)->(40,0)->(80,0)
  // and a sharp side-siding branches at (40,0)->(50,25)->(80,0) with slightly shorter or equal cost
  const payload = {
    rails: [
      {
        id: 'r-1',
        curvePoints: [
          { x: 0, y: 64, z: 0 },
          { x: 20, y: 64, z: 0 },
          { x: 40, y: 64, z: 0 },
        ],
        routeIds: ['route-main'],
      },
      {
        id: 'r-2-straight',
        curvePoints: [
          { x: 40, y: 64, z: 0 },
          { x: 60, y: 64, z: 0 },
          { x: 80, y: 64, z: 0 },
        ],
        routeIds: ['route-main'],
      },
      {
        id: 'r-3-branch',
        curvePoints: [
          { x: 40, y: 64, z: 0 },
          { x: 55, y: 64, z: 12 },
          { x: 80, y: 64, z: 0 },
        ],
        routeIds: ['route-other'],
      },
    ],
  };

  const parsed = parseMagicRailsPayload(payload);
  assert.equal(parsed.rails.length, 3);

  const route: MtrRoute = {
    id: 'route-main',
    name: 'Главная линия',
    shortName: '1',
    number: '1',
    color: '#D62828',
    kind: 'metro',
    headwaySec: 180,
    circular: false,
    segmentDurationsMs: [30000],
    stops: [
      { stationId: 's1', name: 'Старт', x: 0, y: 64, z: 0, dwellMs: 15000 },
      { stationId: 's2', name: 'Финиш', x: 80, y: 64, z: 0, dwellMs: 15000 },
    ],
  };

  const traced = traceRoutesFromMagicRails([route], parsed.rails);
  assert.equal(traced.routesTracedFromMagicRails, 1);
  const path = traced.routes[0].tracedPath3D ?? [];
  assert.ok(path.length >= 4);
  // Every point stays on Z ~= 0 (did NOT take the Z=12 siding)
  for (const pt of path) {
    assert.ok(Math.abs(pt.z) < 0.6, `Expected path to stay on straight main rail, got z=${pt.z}`);
  }

  // Verify bounded smoothing never drifts more than 0.45m from block-exact rail coordinates
  const jagged = [
    { x: 0, y: 64, z: 0 },
    { x: 1, y: 64, z: 0 },
    { x: 2, y: 64, z: 1 },
    { x: 3, y: 64, z: 1 },
    { x: 4, y: 64, z: 2 },
    { x: 5, y: 64, z: 2 },
  ];
  const smoothed = smoothMagicBlockExact3D(jagged, 0.45);
  assert.equal(smoothed.length, jagged.length);
  for (let i = 0; i < jagged.length; i++) {
    const d = Math.hypot(smoothed[i].x - jagged[i].x, smoothed[i].z - jagged[i].z);
    assert.ok(d <= 0.46, `Smoothing drift ${d} exceeded 0.45m bound`);
  }
});

test('Building synthesis shape simplification absorbs diagonal balconies & overhangs without fragmenting', () => {
  // Reconstruct the screenshot #72 case: a 45-degree diagonal building with lower protruding balcony blocks along its SW edge
  const cols = 90;
  const rows = 90;
  const originX = 10000;
  const originZ = -1000;
  const heights = new Float32Array(cols * rows).fill(64);
  const rgb = new Uint8Array(cols * rows * 3);
  for (let i = 0; i < cols * rows; i++) {
    rgb[i * 3] = 105;
    rgb[i * 3 + 1] = 145;
    rgb[i * 3 + 2] = 95;
  }

  const setCell = (gx: number, gz: number, y: number, cr: number, cg: number, cb: number) => {
    if (gx < 0 || gx >= cols || gz < 0 || gz >= rows) return;
    const i = gz * cols + gx;
    heights[i] = y;
    rgb[i * 3] = cr;
    rgb[i * 3 + 1] = cg;
    rgb[i * 3 + 2] = cb;
  };

  // Main 45-degree diagonal slab (u = x + z in [60..116], v = x - z in [-8..8]) at Y=82
  for (let gz = 10; gz < 80; gz++) {
    for (let gx = 10; gx < 80; gx++) {
      const u = gx + gz;
      const v = gx - gz;
      if (u >= 60 && u <= 116 && v >= -8 && v <= 8) {
        setCell(gx, gz, 82, 210, 198, 172);
      }
    }
  }
  // Stepped protruding balconies along the SW facade (v in [-11..-9]) at lower roof height Y=73
  for (let step = 0; step < 12; step++) {
    const bx = 26 + step * 2;
    const bz = 36 + step * 2;
    setCell(bx, bz, 73, 185, 172, 152);
    setCell(bx + 1, bz, 73, 185, 172, 152);
    setCell(bx, bz + 1, 73, 185, 172, 152);
  }

  const grid: HeightColorGrid = {
    originX,
    originZ,
    cols,
    rows,
    cellSize: 1,
    heights,
    rgb,
  };

  const result = runUrbanSynthesisPipeline([grid], [], [], [], {
    targetMode: 'buildings',
    minBuildingHeight: 3,
    minBuildingAreaBlocks: 2,
    shapeSimplification: 0.65,
  });

  // Must synthesize into 1 clean building, NOT 1 main building + 12 tiny balcony squares!
  assert.equal(
    result.buildings.length,
    1,
    `Expected 1 simplified diagonal building, got ${result.buildings.length}`
  );
});

test('Triangular corner buildings: creation, rotation, resize preservation, and urban synthesis detection', () => {
  // 1. Direct footprint & corner detection for all 4 corner orientations
  for (const corner of [0, 1, 2, 3] as const) {
    const tri = createTriangleFootprint(100, 200, 40, 30, 15, corner);
    assert.equal(tri.length, 3);
    const detected = detectTriangleCornerFromFootprint(tri, 100, 200, 15);
    assert.equal(detected, corner, `Expected corner ${corner}, detected ${detected}`);
  }

  // 2. Rotating & resizing a triangular building preserves 3-vertex triangular shape
  const triBuilding: Building3D = {
    id: 'tri-1',
    name: 'Угловой дом',
    street: 'Набережная',
    houseNumber: '64',
    district: 'Центр',
    category: 'residential',
    x: 100,
    z: 200,
    height: 18,
    floors: 4,
    orientationDeg: 0,
    measuredWidth: 40,
    measuredDepth: 30,
    shapeType: 'triangular',
    footprint: createTriangleFootprint(100, 200, 40, 30, 0, 0),
  };

  const rotated = rotateBuilding(triBuilding, 35);
  assert.equal(rotated.footprint.length, 3);
  assert.equal(rotated.shapeType, 'triangular');
  assert.equal(detectTriangleCornerFromFootprint(rotated.footprint, rotated.x, rotated.z, 35), 0);

  const primaryWingId = getBuildingWings(triBuilding)[0].id;
  const resized = resizeBuildingWingCorner(triBuilding, primaryWingId, 1, { x: 130, z: 180 });
  assert.equal(resized.footprint.length, 3);
  assert.equal(resized.shapeType, 'triangular');

  // 3. Urban synthesis detects a right-angled corner building (like #64) as triangular
  const synthGrid = voxelize3DObjects(
    [
      {
        material: 'building',
        x: 10048,
        z: -952,
        width: 34,
        depth: 30,
        baseY: 67,
        topY: 85,
        shape: 'triangle',
        triangleCorner: 0,
      },
    ],
    { originX: 10000, originZ: -1000, widthBlocks: 96, depthBlocks: 96 },
    1,
    67
  );

  const synthResult = runUrbanSynthesisPipeline([synthGrid], [], [], [], {
    targetMode: 'buildings',
    minBuildingHeight: 3,
    minBuildingAreaBlocks: 2,
    shapeSimplification: 0.5,
  });

  assert.equal(synthResult.buildings.length, 1);
  assert.equal(synthResult.buildings[0].shapeType, 'triangular');
  assert.equal(synthResult.buildings[0].footprint.length, 3);
});

test('Online-maps multi-scale zoom LOD transitions smoothly from regional overview to micro street detail', () => {
  assert.equal(clampMapZoom(0.001), MIN_MAP_ZOOM);
  assert.equal(clampMapZoom(99), MAX_MAP_ZOOM);

  const regional = getMapZoomLod(0.02);
  assert.equal(regional.tier, 'regional');
  assert.equal(regional.showSettlements, true);
  assert.equal(regional.showBuildings, false);
  assert.equal(regional.showRoadClass('highway'), true);
  assert.equal(regional.showRoadClass('railway'), true);
  assert.equal(regional.showRoadClass('street'), false);
  assert.equal(regional.poisMode, 'none');
  assert.equal(regional.stationsMode, 'none');
  assert.equal(regional.transitLinesMode, 'major');

  const metro = getMapZoomLod(0.08);
  assert.equal(metro.tier, 'metropolitan');
  assert.equal(metro.showSettlements, true);
  assert.equal(metro.showDistricts, true);
  assert.equal(metro.stationsMode, 'metro-rail');
  assert.equal(metro.showRoadClass('avenue'), true);

  const city = getMapZoomLod(0.24);
  assert.equal(city.tier, 'city');
  assert.equal(city.showBuildings, true);
  assert.equal(city.extrudeBuildings, true);
  assert.equal(city.showDistricts, true);
  assert.equal(city.poisMode, 'major');
  assert.equal(city.transitLinesMode, 'all');

  const quarter = getMapZoomLod(0.55);
  assert.equal(quarter.tier, 'quarter');
  assert.equal(quarter.showHouseNumbers, true);
  assert.equal(quarter.showOneWayArrows, true);
  assert.equal(quarter.poisMode, 'all');
  assert.equal(quarter.showRoadClass('dirt'), true);
  assert.equal(quarter.showRoadClass('service'), true);

  const micro = getMapZoomLod(1.5);
  assert.equal(micro.tier, 'micro');
  assert.equal(micro.showSettlements, false);
  assert.equal(micro.showDistricts, false);
  assert.equal(micro.stationsMode, 'all-labeled');
  assert.equal(micro.poisMode, 'all');
  assert.equal(micro.showPoiLabels, true);

  // Regional settlements include curated Muromorsk & discover outlying stations automatically
  const outlyingStation: MtrStation = {
    id: 'st-far',
    name: 'Ж/Д ст. Новое Село',
    x: 25000,
    y: 66,
    z: 8000,
    color: '#2563EB',
    kinds: ['rail'],
    routeIds: ['r1'],
    district: 'Область',
  };
  const settlements = buildRegionalSettlements([outlyingStation]);
  assert.ok(settlements.some((s) => s.name === 'Муроморск'));
  assert.ok(settlements.some((s) => s.name === 'Новое Село'));
});

test('Editable cities & districts: mergeMapPlaces supports renaming, moving, deleting, and adding custom labels', () => {
  const basePlaces = mergeMapPlaces([]);
  assert.ok(basePlaces.some((p) => p.id === 'set-muromorsk' && p.name === 'Муроморск'));
  assert.ok(basePlaces.some((p) => p.id === 'dist-center' && p.tier === 'district'));

  const edited = mergeMapPlaces(
    [],
    [
      {
        id: 'set-muromorsk',
        name: 'Великий Муроморск',
        subtitle: 'Greater Muromorsk',
        x: 11000,
        z: -1400,
        tier: 'city',
        priority: 100,
      },
      {
        id: 'dist-center',
        name: 'Исторический центр',
        subtitle: 'Старый город',
        x: 10950,
        z: -1500,
        tier: 'district',
        priority: 92,
      },
      {
        id: 'place-custom-1',
        name: 'Южный Квартал',
        x: 12000,
        z: 1200,
        tier: 'district',
        priority: 75,
      },
    ],
    ['set-golovastiki']
  );

  const renamedCity = edited.find((p) => p.id === 'set-muromorsk');
  assert.equal(renamedCity?.name, 'Великий Муроморск');
  assert.equal(renamedCity?.subtitle, 'Greater Muromorsk');
  assert.equal(renamedCity?.isUserEdited, true);

  const renamedDist = edited.find((p) => p.id === 'dist-center');
  assert.equal(renamedDist?.name, 'Исторический центр');
  assert.equal(renamedDist?.subtitle, 'Старый город');

  assert.ok(edited.some((p) => p.id === 'place-custom-1' && p.name === 'Южный Квартал'));
  assert.equal(
    edited.some((p) => p.id === 'set-golovastiki'),
    false,
    'Deleted default place must be omitted'
  );
});

test('Smooth zoom opacity curves transition continuously between 0 and 1 without hard pops', () => {
  // Verify Hermite smoothstep & smoothBand invariants
  assert.equal(smoothstep(0.1, 0.2, 0.05), 0);
  assert.ok(Math.abs(smoothstep(0.1, 0.2, 0.15) - 0.5) < 1e-12);
  assert.equal(smoothstep(0.1, 0.2, 0.25), 1);

  assert.equal(smoothBand(0.1, 0.2, 0.5, 0.6, 0.05), 0);
  assert.equal(smoothBand(0.1, 0.2, 0.5, 0.6, 0.35), 1);
  assert.ok(smoothBand(0.1, 0.2, 0.5, 0.6, 0.55) > 0.4 && smoothBand(0.1, 0.2, 0.5, 0.6, 0.55) < 0.6);
  assert.equal(smoothBand(0.1, 0.2, 0.5, 0.6, 0.7), 0);

  // Buildings fade in smoothly between 0.078 and 0.128, then extrude smoothly between 0.145 and 0.245
  const opLow = computeMapZoomOpacity(0.04);
  const opMidFade = computeMapZoomOpacity(0.103);
  const opExtrudeMid = computeMapZoomOpacity(0.195);
  const opClose = computeMapZoomOpacity(1.1);

  assert.equal(opLow.buildings, 0);
  assert.ok(opMidFade.buildings > 0.2 && opMidFade.buildings < 0.8);
  assert.equal(opMidFade.buildingExtrusion, 0);
  assert.ok(opExtrudeMid.buildingExtrusion > 0.3 && opExtrudeMid.buildingExtrusion < 0.7);
  assert.equal(opClose.buildings, 1);
  assert.equal(opClose.buildingExtrusion, 1);

  // Settlements fade out smoothly as user zooms in past city scale
  assert.equal(opLow.settlements, 1);
  const opSettleMid = computeMapZoomOpacity(0.18);
  assert.ok(opSettleMid.settlements > 0.3 && opSettleMid.settlements < 0.7);
  assert.equal(opClose.settlements, 0);

  // Districts fade in around 0.07, peak at city zoom, fade out around 0.58
  assert.equal(opLow.districts, 0);
  assert.equal(computeMapZoomOpacity(0.25).districts, 1);
  const opDistOut = computeMapZoomOpacity(0.58);
  assert.ok(opDistOut.districts > 0.3 && opDistOut.districts < 0.7);
  assert.equal(opClose.districts, 0);

  // Road classes fade in smoothly by hierarchy
  assert.equal(opLow.roadClassAlpha('highway'), 1);
  assert.equal(opLow.roadClassAlpha('dirt'), 0);
  const opDirtMid = computeMapZoomOpacity(0.38).roadClassAlpha('dirt');
  assert.ok(opDirtMid > 0.3 && opDirtMid < 0.7);
  assert.equal(opClose.roadClassAlpha('dirt'), 1);
});

// ---------------------------------------------------------------------------
// 6 New Features: Parallelograms, Freeform Sculpting, Free Move, Snap Toggle,
// Seamless Same-Height Wing Seams & Visual-Center Interior Address Anchor
// ---------------------------------------------------------------------------

test('Urban synthesis detects skewed parallelogram footprints and rotation preserves skew', () => {
  const synthGrid = voxelize3DObjects(
    [
      {
        material: 'building',
        x: 10048,
        z: -952,
        width: 44,
        depth: 22,
        baseY: 67,
        topY: 87,
        angleDeg: 0,
        shape: 'parallelogram',
        skewDeg: 28,
      },
    ],
    { originX: 10000, originZ: -1000, widthBlocks: 96, depthBlocks: 96 },
    1,
    67
  );

  const result = runUrbanSynthesisPipeline([synthGrid], [], [], [], {
    targetMode: 'buildings',
    minBuildingHeight: 3,
    minBuildingAreaBlocks: 2,
    shapeSimplification: 0.5,
  });

  assert.equal(
    result.buildings.length,
    1,
    `Expected 1 synthesized parallelogram building, got ${result.buildings.length}`
  );
  const b = result.buildings[0];
  assert.equal(b.shapeType, 'parallelogram');
  assert.equal(b.footprint.length, 4);
  assert.ok(
    b.skewDeg !== undefined && Math.abs(b.skewDeg) >= 12,
    `Expected significant detected skewDeg, got ${b.skewDeg}`
  );

  // Direct parallelogram footprint & rotation preservation
  const fp = createParallelogramFootprint(200, 300, 40, 20, 15, 25);
  assert.equal(fp.length, 4);
  const detectedSkew = detectParallelogramSkewFromFootprint(fp, 200, 300, 15);
  assert.ok(Math.abs(detectedSkew - 25) <= 1, `Expected skew ~25°, got ${detectedSkew}`);

  const paraBuilding: Building3D = {
    id: 'b-para',
    name: 'Параллелепипед',
    street: 'Тестовая ул.',
    houseNumber: '12',
    category: 'residential',
    district: 'Центр',
    x: 200,
    z: 300,
    height: 18,
    floors: 5,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 18,
    shapeType: 'parallelogram',
    skewDeg: 25,
    measuredWidth: 40,
    measuredDepth: 20,
    orientationDeg: 15,
    footprint: fp,
  };
  const rotated = rotateBuilding(paraBuilding, 50);
  assert.equal(rotated.shapeType, 'parallelogram');
  assert.equal(rotated.skewDeg, 25);
  assert.equal(rotated.orientationDeg, 50);
  assert.equal(rotated.footprint.length, 4);
});

test('Freeform polygon sculpting supports vertex insert, magnetic move, delete guard, and rotation', () => {
  const neighbor: Building3D = {
    id: 'b-neighbor',
    name: 'Сосед',
    street: 'ул. Свободы',
    houseNumber: '2',
    category: 'residential',
    district: 'Центр',
    x: 150,
    z: 100,
    height: 20,
    floors: 5,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 20,
    measuredWidth: 20,
    measuredDepth: 20,
    orientationDeg: 0,
    footprint: createRectFootprint(150, 100, 20, 20, 0),
  };

  let b: Building3D = {
    id: 'b-sculpt',
    name: 'Свободная форма',
    street: 'ул. Свободы',
    houseNumber: '1',
    category: 'commercial',
    district: 'Центр',
    x: 100,
    z: 100,
    height: 16,
    floors: 4,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 16,
    measuredWidth: 20,
    measuredDepth: 20,
    orientationDeg: 0,
    footprint: createRectFootprint(100, 100, 20, 20, 0),
  };

  b = convertWingToFreeform(b);
  assert.equal(b.shapeType, 'freeform');

  const ins = insertBuildingWingVertex(b, undefined, 1, { x: 120, z: 100 });
  b = ins.building;
  assert.equal(b.footprint.length, 5);
  assert.equal(ins.insertedIdx, 2);
  assert.equal(b.shapeType, 'freeform');

  const snappedMove = moveBuildingWingVertex(
    b,
    undefined,
    ins.insertedIdx,
    { x: 138, z: 91.5 },
    [b, neighbor],
    true,
    8
  );
  assert.equal(snappedMove.snapped, true);
  assert.equal(snappedMove.building.footprint[ins.insertedIdx].x, 140);
  assert.equal(snappedMove.building.footprint[ins.insertedIdx].z, 90);
  b = snappedMove.building;

  const rotated = rotateBuilding(b, 30);
  assert.equal(rotated.shapeType, 'freeform');
  assert.equal(rotated.footprint.length, 5);

  b = removeBuildingWingVertex(b, undefined, 2);
  assert.equal(b.footprint.length, 4);
  b = removeBuildingWingVertex(b, undefined, 0);
  assert.equal(b.footprint.length, 3);
  const blocked = removeBuildingWingVertex(b, undefined, 0);
  assert.equal(blocked.footprint.length, 3);
});

test('Free building move & snapToBuilding toggle control flush neighbor snapping', () => {
  const anchorB: Building3D = {
    id: 'b-anchor',
    name: 'Корпус А',
    street: 'пр. Мира',
    houseNumber: '10',
    category: 'residential',
    district: 'Центр',
    x: 200,
    z: 200,
    height: 20,
    floors: 5,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 20,
    measuredWidth: 40,
    measuredDepth: 20,
    orientationDeg: 0,
    footprint: createRectFootprint(200, 200, 40, 20, 0),
  };

  const moverB: Building3D = {
    id: 'b-mover',
    name: 'Корпус Б',
    street: 'пр. Мира',
    houseNumber: '12',
    category: 'residential',
    district: 'Центр',
    x: 260,
    z: 200,
    height: 20,
    floors: 5,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 20,
    measuredWidth: 20,
    measuredDepth: 20,
    orientationDeg: 0,
    footprint: createRectFootprint(260, 200, 20, 20, 0),
  };

  const snappedRes = moveBuilding(moverB, -27, 0, {
    neighborBuildings: [anchorB, moverB],
    snapToBuilding: true,
    snapTolerance: 9,
  });
  assert.equal(snappedRes.snapped, true);
  assert.equal(snappedRes.building.x, 230, 'Expected flush 0-gap contact (west wall at x=220)');

  const freeRes = moveBuilding(moverB, -27, 0, {
    neighborBuildings: [anchorB, moverB],
    snapToBuilding: false,
    snapTolerance: 9,
  });
  assert.equal(freeRes.snapped, false);
  assert.equal(freeRes.building.x, 233);

  const rectSnapped = snapBuildingRectToStreet(
    { x: 223, z: 190 },
    { x: 243, z: 210 },
    [],
    false,
    90,
    [anchorB],
    undefined,
    true
  );
  const rectFree = snapBuildingRectToStreet(
    { x: 223, z: 190 },
    { x: 243, z: 210 },
    [],
    false,
    90,
    [anchorB],
    undefined,
    false
  );
  assert.equal(rectSnapped.x, 230, 'Expected area-drag to snap flush to anchorB when snapToBuilding=true');
  assert.equal(rectFree.x, 233, 'Expected area-drag to skip building snap when snapToBuilding=false');

  const ptSnap = snapPointToBuildings({ x: 219, z: 200 }, [anchorB], undefined, undefined, 8);
  assert.equal(ptSnap.snapped, true);
  assert.equal(ptSnap.x, 220);
});

test('Same-height attached wings hide shared internal boundaries while stepped heights keep roof borders', () => {
  const w1 = {
    id: 'w1',
    label: 'Корпус 1',
    x: 80,
    z: 100,
    footprint: createRectFootprint(80, 100, 40, 40, 0),
    height: 20,
    floors: 5,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 20,
    measuredWidth: 40,
    measuredDepth: 40,
    orientationDeg: 0,
  };
  const w2Same = {
    id: 'w2',
    label: 'Корпус 2',
    x: 120,
    z: 100,
    footprint: createRectFootprint(120, 100, 40, 40, 0),
    height: 20,
    floors: 5,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 20,
    measuredWidth: 40,
    measuredDepth: 40,
    orientationDeg: 0,
  };

  const sameEdges1 = computeWingExposedEdges(w1, [w1, w2Same], SERVER_GROUND_Y);
  const sameEdges2 = computeWingExposedEdges(w2Same, [w1, w2Same], SERVER_GROUND_Y);

  assert.equal(sameEdges1.exposedRoofEdges.length, 3);
  assert.equal(sameEdges2.exposedRoofEdges.length, 3);
  assert.equal(sameEdges1.exposedWallEdges.length, 3);
  assert.equal(sameEdges2.exposedWallEdges.length, 3);
  assert.equal(
    sameEdges1.exposedRoofEdges.some((e) => Math.abs(e.a.x - 100) < 0.2 && Math.abs(e.b.x - 100) < 0.2),
    false,
    'Shared seam x=100 must not appear in exposedRoofEdges for same-height attached wings'
  );

  const w2Tall = { ...w2Same, height: 36, floors: 9, roofY: SERVER_GROUND_Y + 36 };
  const tallEdges2 = computeWingExposedEdges(w2Tall, [w1, w2Tall], SERVER_GROUND_Y);
  const podiumEdges1 = computeWingExposedEdges(w1, [w1, w2Tall], SERVER_GROUND_Y);

  assert.equal(tallEdges2.exposedRoofEdges.length, 4);
  assert.equal(podiumEdges1.exposedRoofEdges.length, 4);
  assert.equal(podiumEdges1.exposedWallEdges.length, 3);
  assert.equal(tallEdges2.exposedWallEdges.length, 4);
});

test('Building address anchor lands strictly inside concave U-shaped complexes and right-angled triangles', () => {
  const pointInPoly = (px: number, pz: number, poly: Array<{ x: number; z: number }>) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const zi = poly[i].z;
      const xj = poly[j].x;
      const zj = poly[j].z;
      if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  const uComplex: Building3D = {
    id: 'b-u-complex',
    name: 'П-образный дом',
    street: 'Невский пр.',
    houseNumber: '42',
    category: 'residential',
    district: 'Центр',
    x: 100,
    z: 100,
    height: 24,
    floors: 6,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 24,
    shapeType: 'complex',
    footprint: createRectFootprint(100, 60, 100, 20, 0),
    wings: [
      {
        id: 'u-top',
        label: 'Корпус 1',
        x: 100,
        z: 60,
        footprint: createRectFootprint(100, 60, 100, 20, 0),
        height: 24,
        floors: 6,
        baseY: SERVER_GROUND_Y,
        roofY: SERVER_GROUND_Y + 24,
        measuredWidth: 100,
        measuredDepth: 20,
        orientationDeg: 0,
      },
      {
        id: 'u-left',
        label: 'Корпус 2',
        x: 60,
        z: 110,
        footprint: createRectFootprint(60, 110, 20, 80, 0),
        height: 24,
        floors: 6,
        baseY: SERVER_GROUND_Y,
        roofY: SERVER_GROUND_Y + 24,
        measuredWidth: 20,
        measuredDepth: 80,
        orientationDeg: 0,
      },
      {
        id: 'u-right',
        label: 'Корпус 3',
        x: 140,
        z: 110,
        footprint: createRectFootprint(140, 110, 20, 80, 0),
        height: 24,
        floors: 6,
        baseY: SERVER_GROUND_Y,
        roofY: SERVER_GROUND_Y + 24,
        measuredWidth: 20,
        measuredDepth: 80,
        orientationDeg: 0,
      },
    ],
  };

  const uAnchor = computeBuildingLabelAnchor(uComplex);
  const insideAnyWing = (uComplex.wings ?? []).some((w) =>
    pointInPoly(uAnchor.x, uAnchor.z, w.footprint)
  );
  assert.equal(
    insideAnyWing,
    true,
    `U-complex label anchor (${uAnchor.x}, ${uAnchor.z}) must lie strictly inside a wing, not in the courtyard`
  );
  assert.ok(uAnchor.maxRadius >= 8, `Expected generous interior clearance, got ${uAnchor.maxRadius}`);

  const triFp = createTriangleFootprint(200, 200, 40, 40, 0, 0);
  const triB: Building3D = {
    id: 'b-tri',
    name: 'Угловой дом',
    street: 'Садовая ул.',
    houseNumber: '7',
    category: 'residential',
    district: 'Центр',
    x: 200,
    z: 200,
    height: 20,
    floors: 5,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 20,
    shapeType: 'triangular',
    measuredWidth: 40,
    measuredDepth: 40,
    orientationDeg: 0,
    footprint: triFp,
  };
  const triAnchor = computeBuildingLabelAnchor(triB);
  assert.equal(
    pointInPoly(triAnchor.x, triAnchor.z, triFp),
    true,
    `Triangle label anchor (${triAnchor.x}, ${triAnchor.z}) must be strictly inside the triangle`
  );
  assert.ok(triAnchor.maxRadius > 10, `Expected analytical inradius ~11.7, got ${triAnchor.maxRadius}`);
});

test('Kaliningrad solar insolation computes accurate solstice altitude, diurnal shadow sweep, and height scaling', () => {
  // 1. Summer solstice (June 21) solar noon in Kaliningrad (54.71°N, 20.45°E, UTC+2 -> solar noon ~12:40)
  const summerProbe = computeSolarPosition('2026-06-21', 760);
  const summerNoon = computeSolarPosition('2026-06-21', summerProbe.solarNoonMinutes);
  assert.ok(
    Math.abs(summerNoon.altitudeDeg - (90 - KALININGRAD_GEO.latDeg + 23.44)) < 0.7,
    `Expected Kaliningrad June 21 noon altitude ~58.7°, got ${summerNoon.altitudeDeg.toFixed(2)}°`
  );
  assert.ok(
    Math.abs(summerNoon.azimuthDeg - 180) < 2,
    `Expected solar noon azimuth ~180° (South), got ${summerNoon.azimuthDeg.toFixed(2)}°`
  );
  assert.ok(
    summerNoon.shadowDir.z < -0.95 && Math.abs(summerNoon.shadowDir.x) < 0.1,
    'Noon shadow in Northern Hemisphere must point due North (-Z)'
  );
  assert.ok(
    summerNoon.dayLengthMinutes > 1000 && summerNoon.dayLengthMinutes < 1065,
    `Expected ~17h15m Kaliningrad summer day, got ${summerNoon.dayLengthMinutes.toFixed(0)} min`
  );

  // 2. Winter solstice (Dec 21) solar noon in Kaliningrad (~11.9° altitude -> much longer shadows!)
  const winterProbe = computeSolarPosition('2026-12-21', 756);
  const winterNoon = computeSolarPosition('2026-12-21', winterProbe.solarNoonMinutes);
  assert.ok(
    Math.abs(winterNoon.altitudeDeg - (90 - KALININGRAD_GEO.latDeg - 23.44)) < 0.7,
    `Expected Kaliningrad Dec 21 noon altitude ~11.9°, got ${winterNoon.altitudeDeg.toFixed(2)}°`
  );
  assert.ok(
    winterNoon.shadowLengthPerBlock > summerNoon.shadowLengthPerBlock * 4,
    'Winter noon shadows must be >4x longer than summer noon shadows at Kaliningrad latitude'
  );
  assert.ok(
    winterNoon.dayLengthMinutes > 400 && winterNoon.dayLengthMinutes < 460,
    `Expected ~7h12m Kaliningrad winter day, got ${winterNoon.dayLengthMinutes.toFixed(0)} min`
  );

  // 3. Morning vs evening shadow direction & night cutoff
  const morning = computeSolarPosition('2026-06-21', 8 * 60); // 08:00 KALT (Sun in East)
  const evening = computeSolarPosition('2026-06-21', 18 * 60); // 18:00 KALT (Sun in West)
  const night = computeSolarPosition('2026-12-21', 1 * 60); // 01:00 KALT (deep night)

  assert.ok(morning.shadowDir.x < -0.7, 'Morning sun in East must cast shadows West (-X)');
  assert.ok(evening.shadowDir.x > 0.7, 'Evening sun in West must cast shadows East (+X)');
  assert.equal(night.phase, 'night');
  assert.equal(night.shadowOpacity, 0);

  // 4. Height proportionality & facade illumination
  const fp = createRectFootprint(100, 100, 20, 20, 0);
  const s20 = computeShadowOffset(20, summerNoon);
  const s40 = computeShadowOffset(40, summerNoon);
  assert.ok(Math.abs(Math.hypot(s40.dx, s40.dz) - 2 * Math.hypot(s20.dx, s20.dz)) < 1e-6);

  assert.equal(computeWingShadowGeometry(fp, 20, night), null);
  const dayGeom = computeWingShadowGeometry(fp, 20, summerNoon);
  assert.ok(dayGeom !== null && dayGeom.shiftedRoof.length === 4);

  const southWallLight = computeFacadeSolarIntensity(0, 1, summerNoon);
  const northWallLight = computeFacadeSolarIntensity(0, -1, summerNoon);
  assert.ok(
    southWallLight > northWallLight + 0.35,
    `South facade (${southWallLight.toFixed(2)}) must be brighter than North facade (${northWallLight.toFixed(2)}) at noon`
  );
});

test('isMuromorskMetroRoute distinguishes Muromorsk Metro lines from foreign or surface routes', () => {
  assert.equal(
    isMuromorskMetroRoute({
      kind: 'metro',
      stops: [{ stationId: 's1', name: 'Площадь Свободы', x: 10550, y: 45, z: -620, dwellMs: 15000 }],
    }),
    true
  );
  assert.equal(
    isMuromorskMetroRoute({
      kind: 'metro',
      stops: [{ stationId: 's2', name: 'Красноград', x: -12000, y: 45, z: 18000, dwellMs: 15000 }],
    }),
    false
  );
  assert.equal(
    isMuromorskMetroRoute({
      kind: 'tram',
      stops: [{ stationId: 's3', name: 'Трамвай', x: 10550, y: 64, z: -620, dwellMs: 15000 }],
    }),
    false
  );
});

test('Shadow occlusion helpers: CW winding normalization, half-plane clipping, and 3D wall cast shadows', () => {
  // 1. CCW screen triangle is reversed to CW (positive signed area in canvas coords)
  const ccw = [
    { sx: 0, sy: 0 },
    { sx: 0, sy: 100 },
    { sx: 100, sy: 0 },
  ];
  const cw = ensureScreenPolygonCW(ccw);
  let area2 = 0;
  for (let i = 0; i < cw.length; i++) {
    const j = (i + 1) % cw.length;
    area2 += cw[i].sx * cw[j].sy - cw[j].sx * cw[i].sy;
  }
  assert.ok(area2 > 0, `Expected CW positive signed area, got ${area2}`);

  // 2. Half-plane clipping keeps only z >= 10
  const square = createRectFootprint(0, 10, 20, 20, 0); // x:[-10..10], z:[0..20]
  const clipped = clipPolygonToHalfPlane(square, 0, 10, 0, 1);
  assert.ok(clipped.length >= 4);
  assert.ok(clipped.every((p) => p.z >= 10 - 1e-4));

  // 3. Upwind taller building casts shadow onto south-facing wall of target building at solar noon
  const noon = computeSolarPosition('2026-06-21', computeSolarPosition('2026-06-21', 760).solarNoonMinutes);
  // Target wall runs X=[0..40] at Z=0 facing South (outward normal 0, +1)
  // Tall upwind caster stands South of the wall at Z=15 (X:[10..30], Z:[10..20]) with topY=94 vs wall [64..84]
  const casterFp = createRectFootprint(20, 15, 20, 10, 0);
  const wallPolys = computeWallShadowPolygons(
    { x: 0, z: 0 },
    { x: 40, z: 0 },
    0,
    1,
    64,
    84,
    casterFp,
    64,
    94,
    noon
  );
  assert.ok(wallPolys.length > 0, 'Upwind taller caster south of wall must cast shadow onto wall');

  // Downwind caster (Z=-20, north of south-facing wall) must NOT cast shadow onto south wall
  const downwindFp = createRectFootprint(20, -20, 20, 10, 0);
  const noShadow = computeWallShadowPolygons(
    { x: 0, z: 0 },
    { x: 40, z: 0 },
    0,
    1,
    64,
    84,
    downwindFp,
    64,
    94,
    noon
  );
  assert.equal(noShadow.length, 0);

  // Back-facing north wall (normal 0, -1) gets no sun-facing cast shadow from south sun
  const backWall = computeWallShadowPolygons(
    { x: 0, z: 0 },
    { x: 40, z: 0 },
    0,
    -1,
    64,
    84,
    casterFp,
    64,
    94,
    noon
  );
  assert.equal(backWall.length, 0);
});

test('Automatic house numbering assigns odd/even numbers on new building & new/renamed streets while preserving custom suffixes', () => {
  const street: StreetSegment = {
    id: 'st-nevsky',
    name: 'Невская улица',
    district: 'Центр',
    roadClass: 'street',
    width: 14,
    elevationY: SERVER_GROUND_Y,
    simAllowed: true,
    points: [
      { x: 0, z: 0 },
      { x: 300, z: 0 },
    ],
  };

  const makeB = (id: string, x: number, z: number, streetName = '', houseNumber = ''): Building3D => ({
    id,
    name: `Дом ${id}`,
    street: streetName,
    houseNumber,
    district: 'Центр',
    category: 'residential',
    x,
    z,
    height: 16,
    floors: 4,
    baseY: SERVER_GROUND_Y,
    roofY: SERVER_GROUND_Y + 16,
    footprint: createRectFootprint(x, z, 20, 14, 0),
  });

  const applyUpdates = (base: Building3D[], updates: Building3D[]) => {
    const map = new Map(updates.map((b) => [b.id, b]));
    return base.map((b) => map.get(b.id) ?? b);
  };

  // 1. Drawing a brand-new street automatically assigns street name + odd/even numbers to nearby buildings
  const existing = [
    makeB('b1', 40, -24), // left side (z < 0) -> 1
    makeB('b2', 120, -24), // left side -> 3
    makeB('b3', 60, 24), // right side (z > 0) -> 2
    makeB('b4', 150, 24, 'Невская улица', '14А'), // custom alphanumeric suffix preserved
    makeB('b-far', 100, 180), // too far from street -> untouched
  ];

  const afterNewStreet = autoAddressBuildingsForStreet(street, existing, [street]);
  const listAfterNewStreet = applyUpdates(existing, afterNewStreet.updatedBuildings);
  const byId = (list: Building3D[], id: string) => list.find((b) => b.id === id)!;
  assert.equal(byId(listAfterNewStreet, 'b1').street, 'Невская улица');
  assert.equal(byId(listAfterNewStreet, 'b1').houseNumber, '1');
  assert.equal(byId(listAfterNewStreet, 'b2').houseNumber, '3');
  assert.equal(byId(listAfterNewStreet, 'b3').houseNumber, '2');
  assert.equal(byId(listAfterNewStreet, 'b4').houseNumber, '14А');
  assert.equal(byId(listAfterNewStreet, 'b-far').street, '');
  assert.equal(byId(listAfterNewStreet, 'b-far').houseNumber, '');

  // 2. Inserting a new building between b1 (x=40) and b2 (x=120) auto-assigns nearest street and shifts b2 from 3 -> 5
  const inserted = makeB('b-mid', 80, -24);
  const afterInsert = autoAddressNewBuilding(inserted, listAfterNewStreet, [street]);
  const listAfterInsert = [
    ...applyUpdates(listAfterNewStreet, afterInsert.updatedExisting),
    afterInsert.created,
  ];
  assert.equal(afterInsert.created.street, 'Невская улица');
  assert.equal(afterInsert.created.houseNumber, '3');
  assert.equal(byId(listAfterInsert, 'b1').houseNumber, '1');
  assert.equal(byId(listAfterInsert, 'b2').houseNumber, '5');
  assert.equal(byId(listAfterInsert, 'b3').houseNumber, '2');

  // 3. Renaming the street updates attached buildings to the new street name automatically
  const renamedStreet: StreetSegment = { ...street, name: 'Морской проспект' };
  const afterRename = autoAddressBuildingsForStreet(
    renamedStreet,
    listAfterInsert,
    [renamedStreet],
    { previousStreetName: 'Невская улица' }
  );
  const listAfterRename = applyUpdates(listAfterInsert, afterRename.updatedBuildings);
  assert.equal(byId(listAfterRename, 'b1').street, 'Морской проспект');
  assert.equal(byId(listAfterRename, 'b-mid').street, 'Морской проспект');
  assert.equal(byId(listAfterRename, 'b4').street, 'Морской проспект');
  assert.equal(byId(listAfterRename, 'b4').houseNumber, '14А');
});

test('Territory label placement stays strictly inside concave water polygons, rotates to fit narrow channels, and stays in camera viewport', () => {
  // 1. C-shaped / curved river wrapping around an island (centroid falls on dry land in the middle!)
  const curvedRiver = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 460 },
    { x: 100, y: 460 },
    { x: 100, y: 380 },
    { x: 410, y: 380 },
    { x: 410, y: 180 },
    { x: 100, y: 180 },
  ];
  const curvedPlacement = computeTerritoryLabelPlacement(curvedRiver, 800, 600, 96, 16);
  assert.ok(curvedPlacement, 'Curved river must produce a valid placement');
  assert.equal(
    pointInScreenPolygon(curvedPlacement.sx, curvedPlacement.sy, curvedRiver),
    true,
    `Label (${curvedPlacement.sx.toFixed(1)}, ${curvedPlacement.sy.toFixed(1)}) must be strictly inside water, not on the island`
  );

  // 2. Narrow 45-degree diagonal river ribbon (horizontal label would cross the banks, rotated label fits along the channel)
  const diagRibbon = [
    { x: 120, y: 460 },
    { x: 480, y: 100 },
    { x: 520, y: 140 },
    { x: 160, y: 500 },
  ];
  const diagPlacement = computeTerritoryLabelPlacement(diagRibbon, 800, 600, 110, 14);
  assert.ok(diagPlacement, 'Diagonal ribbon must produce a placement');
  assert.equal(pointInScreenPolygon(diagPlacement.sx, diagPlacement.sy, diagRibbon), true);
  assert.equal(diagPlacement.fitsInside, true, 'Rotated label must fit cleanly inside diagonal river ribbon');
  const angleDeg = (diagPlacement.angle * 180) / Math.PI;
  assert.ok(
    Math.abs(Math.abs(angleDeg) - 45) < 12,
    `Expected label to rotate ~-45° along the channel, got ${angleDeg.toFixed(1)}°`
  );

  // 3. Large river extending far outside the camera viewport still places label visibly inside viewport & water
  const offscreenRiver = [
    { x: -1200, y: 240 },
    { x: 360, y: 240 },
    { x: 360, y: 360 },
    { x: -1200, y: 360 },
  ];
  const visiblePlacement = computeTerritoryLabelPlacement(offscreenRiver, 800, 600, 88, 16);
  assert.ok(visiblePlacement, 'Partially off-screen river must still be labeled in visible part');
  assert.ok(
    visiblePlacement.sx > 20 && visiblePlacement.sx < 780 && visiblePlacement.sy > 20 && visiblePlacement.sy < 580,
    `Label (${visiblePlacement.sx}, ${visiblePlacement.sy}) must stay inside active camera viewport`
  );
  assert.equal(pointInScreenPolygon(visiblePlacement.sx, visiblePlacement.sy, offscreenRiver), true);
});

test('Clipped road/route polyline tracing preserves starting node and first segment without NaN skip', () => {
  // 1. Simple 2-node road inside viewport must start with explicit M at node 0 and L to node 1
  const twoNodeCmds = buildClippedPolylinePathCommands(
    [
      { sx: 100, sy: 200 },
      { sx: 400, sy: 260 },
    ],
    -64,
    -64,
    864,
    664
  );
  assert.deepEqual(twoNodeCmds, [
    { op: 'M', x: 100, y: 200 },
    { op: 'L', x: 400, y: 260 },
  ]);

  // 2. 5-node road (like "Грунтовая дорога #1") must connect node 0 -> 1 -> 2 -> 3 -> 4 continuously
  const fiveNodeCmds = buildClippedPolylinePathCommands(
    [
      { sx: 220, sy: 510 },
      { sx: 310, sy: 340 },
      { sx: 480, sy: 220 },
      { sx: 640, sy: 350 },
      { sx: 560, sy: 480 },
    ],
    -64,
    -64,
    864,
    664
  );
  assert.equal(fiveNodeCmds[0].op, 'M');
  assert.equal(fiveNodeCmds[0].x, 220);
  assert.equal(fiveNodeCmds[0].y, 510);
  assert.equal(fiveNodeCmds[1].op, 'L');
  assert.equal(fiveNodeCmds[1].x, 310);
  assert.equal(fiveNodeCmds[1].y, 340);
  assert.equal(fiveNodeCmds.length, 5, 'Should emit 1 M + 4 L commands for 4 continuous segments');

  // 3. Re-entry after leaving viewport emits a fresh M command
  const reentryCmds = buildClippedPolylinePathCommands(
    [
      { sx: 100, sy: 100 },
      { sx: 200, sy: 100 },
      { sx: 1500, sy: 100 },
      { sx: 1500, sy: 400 },
      { sx: 200, sy: 400 },
    ],
    0,
    0,
    800,
    600
  );
  const moveTos = reentryCmds.filter((c) => c.op === 'M');
  assert.equal(moveTos.length, 2, 'Should start with M and emit a second M when re-entering viewport');
  assert.equal(moveTos[0].x, 100);
  assert.equal(moveTos[0].y, 100);
});

test('Territory snapping magnetically locks to existing territory nodes first, then boundary edges, and respects excludeLandId', () => {
  const lake: LandFeature = {
    id: 'water-1',
    name: 'Большое озеро',
    kind: 'water',
    polygon: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 80 },
      { x: 0, z: 80 },
    ],
  };

  // 1. Near corner vertex -> snaps to exact node coordinates with priority over edge
  const vSnap = snapPointToLandFeatures({ x: 97, z: 4 }, [lake], 14);
  assert.equal(vSnap.snapped, true);
  assert.equal(vSnap.snapKind, 'vertex');
  assert.equal(vSnap.x, 100);
  assert.equal(vSnap.z, 0);
  assert.equal(vSnap.targetLandId, 'water-1');
  assert.equal(vSnap.targetKind, 'water');

  // 2. Near middle of edge -> snaps orthogonally onto edge
  const eSnap = snapPointToLandFeatures({ x: 52, z: 85 }, [lake], 14);
  assert.equal(eSnap.snapped, true);
  assert.equal(eSnap.snapKind, 'edge');
  assert.equal(eSnap.x, 52);
  assert.equal(eSnap.z, 80);
  assert.ok(eSnap.snapEdge);

  // 3. Excluding self when dragging own vertex does NOT snap to itself
  const selfExcluded = snapPointToLandFeatures({ x: 99, z: 1 }, [lake], 14, 'water-1');
  assert.equal(selfExcluded.snapped, false);
  assert.equal(selfExcluded.snapKind, 'none');

  // 4. Far away -> no snap
  const farSnap = snapPointToLandFeatures({ x: 240, z: 240 }, [lake], 14);
  assert.equal(farSnap.snapped, false);
});

test('Seamless boundary joining hides shared/overlapping borders between same-type territories while keeping borders between different types', () => {
  // Two flush node-snapped water territories sharing vertical seam X=100, Z=[0..100]
  const waterLeft: LandFeature = {
    id: 'w-left',
    name: 'Река запад',
    kind: 'water',
    polygon: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ],
  };
  const waterRight: LandFeature = {
    id: 'w-right',
    name: 'Река восток',
    kind: 'water',
    polygon: [
      { x: 100, z: 0 },
      { x: 200, z: 0 },
      { x: 200, z: 100 },
      { x: 100, z: 100 },
    ],
  };
  // Adjacent park sharing bottom border Z=100 with waterLeft (DIFFERENT kind!)
  const parkSouth: LandFeature = {
    id: 'p-south',
    name: 'Набережный парк',
    kind: 'park',
    polygon: [
      { x: 0, z: 100 },
      { x: 100, z: 100 },
      { x: 100, z: 200 },
      { x: 0, z: 200 },
    ],
  };

  const landIdx = buildLandSpatialIndex([waterLeft, waterRight, parkSouth]);
  const all = landIdx.queryAABB({ minX: -50, maxX: 250, minZ: -50, maxZ: 250 });
  const byId = new Map(all.map((item) => [item.feature.id, item]));

  const leftEntry = byId.get('w-left')!;
  const rightEntry = byId.get('w-right')!;
  const parkEntry = byId.get('p-south')!;

  // Shared vertical seam at X=100 must be completely removed from BOTH water territories (3 outer edges left each!)
  assert.equal(leftEntry.exposedBorderEdges.length, 3, 'waterLeft should hide shared seam with waterRight');
  assert.equal(rightEntry.exposedBorderEdges.length, 3, 'waterRight should hide shared seam with waterLeft');
  const hasInternalSeam = (edges: Array<{ a: { x: number; z: number }; b: { x: number; z: number } }>) =>
    edges.some((e) => Math.abs(e.a.x - 100) < 0.1 && Math.abs(e.b.x - 100) < 0.1);
  assert.equal(hasInternalSeam(leftEntry.exposedBorderEdges), false);
  assert.equal(hasInternalSeam(rightEntry.exposedBorderEdges), false);

  // Park touching water is a DIFFERENT kind -> must keep all 4 borders intact!
  assert.equal(parkEntry.exposedBorderEdges.length, 4, 'Park touching water must keep its shore border');

  // Overlapping same-type territories strip all interior edges cleanly
  const forestA: LandFeature = {
    id: 'park-a',
    name: 'Лес А',
    kind: 'park',
    polygon: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ],
  };
  const forestB: LandFeature = {
    id: 'park-b',
    name: 'Лес Б',
    kind: 'park',
    polygon: [
      { x: 50, z: -20 },
      { x: 150, z: -20 },
      { x: 150, z: 120 },
      { x: 50, z: 120 },
    ],
  };
  const exposedA = computeLandExposedEdges(forestA, [forestB.polygon]);
  // Right edge X=100 is strictly inside forestB -> removed; top/bottom edges clipped to X=[0..50]
  assert.equal(
    exposedA.some((e) => Math.abs(e.a.x - 100) < 0.1 && Math.abs(e.b.x - 100) < 0.1),
    false,
    'Overlapped internal edge at X=100 must be hidden'
  );
  assert.equal(
    exposedA.length,
    3,
    'forestA should have 3 exterior edges (left + clipped top [0..50] + clipped bottom [0..50])'
  );
  for (const e of exposedA) {
    assert.ok(
      e.a.x <= 50.1 && e.b.x <= 50.1,
      `Exposed edge (${e.a.x},${e.a.z})->(${e.b.x},${e.b.z}) must not extend inside forestB`
    );
  }
});









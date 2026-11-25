import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanMtrName,
  classifyTransportKind,
  extractRouteNumber,
  extractServerClockOffsetMs,
  parseDeparturesPayload,
  parseMtrStationsAndRoutes,
} from './mtrParser';
import {
  computeStreetRoute,
  computeTransitRoutes,
  formatDistanceRu,
  formatDurationRu,
} from './routing';
import {
  computeActiveVehiclesOnRoute,
  formatLocalTimeRu,
  getNextDepartureWaitSec,
  parseLocalTimeInputToEpochMs,
} from './scheduleSync';
import {
  createRectFootprint,
  hitTestBuilding,
  screenToWorld,
  worldToScreen,
} from './projection';
import {
  buildFallbackMtrData,
  DEFAULT_BUILDINGS,
  DEFAULT_STREETS,
} from '../data/mursDefaultData';
import type { CameraState } from '../types/map';

test('MTR parser cleans bilingual station names and classifies transport kinds', () => {
  const parsed = cleanMtrName('Морской бульвар|Morskoy bulvar');
  assert.equal(parsed.ru, 'Морской бульвар');
  assert.equal(parsed.en, 'Morskoy bulvar');

  assert.equal(
    classifyTransportKind({ id: '1', name: 'Линия 1|Line 1', color: 0xef161e, jmeType: 'train_metro', stations: [] }),
    'metro'
  );
  assert.equal(
    classifyTransportKind({ id: '2', name: '(Т5) Вакса->Яхтенная', color: 0xcd2d36, jmeType: 'train_tram', stations: [] }),
    'tram'
  );
  assert.equal(
    classifyTransportKind({ id: '3', name: '(Тр8) Рыбацкая наб.', color: 0x0e58d0, jmeType: 'train_bus', stations: [] }),
    'trolleybus'
  );
  assert.equal(
    extractRouteNumber({ id: '1', name: 'Линия 2|Line 2', color: 0, stations: [] }, 'metro'),
    'M2'
  );
});

test('MTR parser normalizes raw stations-and-routes payload', () => {
  const { stations, routes } = parseMtrStationsAndRoutes({
    data: {
      stations: [
        { id: 's1', name: 'Театральная|Teatralnaya', color: 0xef161e },
        { id: 's2', name: 'Народная|Narodnaya', color: 0xef161e },
      ],
      routes: [
        {
          id: 'r1',
          name: 'Линия 1|Line 1',
          color: 0xef161e,
          jmeType: 'train_metro',
          hidden: false,
          stations: [
            { id: 's1', x: 10904, y: 50, z: -1492, name: '1', dwellTime: 12000 },
            { id: 's2', x: 10084, y: 50, z: -758, name: '2', dwellTime: 12000 },
          ],
          durations: [48000],
        },
      ],
    },
  });

  assert.equal(stations.length, 2);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'metro');
  assert.equal(routes[0].segmentDurationsMs[0], 48000);
});

test('Multimodal routing computes transit with metro transfer, walk, and faster SIM', () => {
  const { stations, routes } = buildFallbackMtrData();
  const start = { label: 'Театральная', x: 10904, z: -1492 };
  const end = { label: 'Дворец Спорта', x: 13520, z: 1401 };

  const transitRoutes = computeTransitRoutes(start, end, stations, routes, DEFAULT_STREETS);
  assert.ok(transitRoutes.length >= 1, 'Expected at least one transit route');
  const bestTransit = transitRoutes[0];
  assert.equal(bestTransit.mode, 'transit');
  assert.ok(bestTransit.legs.some((l) => l.type === 'transit'), 'Expected MTR transit leg');
  assert.ok(bestTransit.transfers >= 1, 'Expected transfer from Line 1 to Line 2');

  const walkRoute = computeStreetRoute(start, end, DEFAULT_STREETS, 'walk');
  const simScooter = computeStreetRoute(start, end, DEFAULT_STREETS, 'sim', 'scooter');
  const simEbike = computeStreetRoute(start, end, DEFAULT_STREETS, 'sim', 'ebike');

  assert.ok(simScooter.totalDurationSec < walkRoute.totalDurationSec, 'Scooter must be faster than walking');
  assert.ok(simEbike.totalDurationSec <= simScooter.totalDurationSec, 'E-bike must be at least as fast as scooter');
  assert.ok(bestTransit.totalDurationSec < walkRoute.totalDurationSec, 'Metro transit must beat walking over ~4km');
});

test('2.5D/3D projection and inverse projection round-trip accurately at both 2D and 3D pitch', () => {
  const cam2D: CameraState = { x: 10550, z: -620, zoom: 0.45, pitch: 0, bearing: 0 };
  const cam3D: CameraState = { x: 10550, z: -620, zoom: 0.45, pitch: 48, bearing: 22 };

  for (const cam of [cam2D, cam3D]) {
    const pt = { x: 10904, z: -1492 };
    const projected = worldToScreen(pt.x, pt.z, 0, cam, 1440, 900);
    const back = screenToWorld(projected.sx, projected.sy, cam, 1440, 900);
    assert.ok(Math.abs(back.x - pt.x) < 1.5, `X round-trip drift too high: ${back.x} vs ${pt.x}`);
    assert.ok(Math.abs(back.z - pt.z) < 1.5, `Z round-trip drift too high: ${back.z} vs ${pt.z}`);
  }
});

test('3D building hit-testing accurately selects extruded buildings and initial default schematic has no buildings', () => {
  assert.equal(DEFAULT_BUILDINGS.length, 0, 'Initial schematic must contain no default buildings');
  const cam: CameraState = { x: 10890, z: -1390, zoom: 0.8, pitch: 46, bearing: 0 };
  const sampleBuilding = {
    id: 'b-test-meriya',
    name: 'Тестовое здание',
    street: 'Театральная площадь',
    houseNumber: '1',
    district: 'Центр',
    category: 'civic' as const,
    x: 10890,
    z: -1390,
    footprint: createRectFootprint(10890, -1390, 60, 40, 0),
    height: 28,
    floors: 7,
  };
  const roofCenter = worldToScreen(sampleBuilding.x, sampleBuilding.z, sampleBuilding.height, cam, 1440, 900);
  const hit = hitTestBuilding(roofCenter.sx, roofCenter.sy, [sampleBuilding], cam, 1440, 900);
  assert.equal(hit?.id, 'b-test-meriya');

  const fp = createRectFootprint(100, 200, 40, 20, 0);
  assert.equal(fp.length, 4);
});

test('Russian duration and distance formatters', () => {
  assert.equal(formatDurationRu(45), '45 сек');
  assert.equal(formatDurationRu(185), '3 мин');
  assert.equal(formatDurationRu(3900), '1 ч 5 мин');
  assert.equal(formatDistanceRu(420), '420 м');
  assert.equal(formatDistanceRu(2450), '2,5 км');
});

test('Auto (car) mode routes cleanly and beats walk/SIM, avoiding railway & pedestrian corridors', () => {
  const start = { label: 'Старт', x: 0, z: 0 };
  const end = { label: 'Финиш', x: 600, z: 0 };
  const streets = [
    {
      id: 'ped-short',
      name: 'Пешеходный мост',
      district: 'Центр',
      roadClass: 'pedestrian' as const,
      width: 6,
      simAllowed: false,
      points: [
        { x: 0, z: 0 },
        { x: 600, z: 0 },
      ],
    },
    {
      id: 'hwy-detour',
      name: 'Проспект Авто',
      district: 'Центр',
      roadClass: 'highway' as const,
      width: 26,
      simAllowed: true,
      points: [
        { x: 0, z: 0 },
        { x: 0, z: 120 },
        { x: 600, z: 120 },
        { x: 600, z: 0 },
      ],
    },
  ];

  const autoRoute = computeStreetRoute(start, end, streets, 'auto');
  const walkRoute = computeStreetRoute(start, end, streets, 'walk');

  assert.equal(autoRoute.mode, 'auto');
  assert.equal(autoRoute.legs[0].type, 'auto');
  assert.ok(autoRoute.totalDurationSec < walkRoute.totalDurationSec, 'Car must be faster than walking');
  // Car must take the highway detour at z=120 rather than the pedestrian bridge at z=0
  assert.ok(
    autoRoute.legs.some((l) => l.points.some((p) => p.z > 80)),
    'Auto route must follow drivable roads instead of pedestrian paths'
  );
});

test('Off-road routing detours around 3D buildings and water polygons instead of cutting through them', () => {
  const start = { label: 'A', x: 0, z: 0 };
  const end = { label: 'B', x: 200, z: 0 };
  const blockingBuilding = {
    id: 'b-block',
    name: 'Квартальный корпус',
    street: 'Тестовая',
    houseNumber: '1',
    district: 'Центр',
    category: 'residential' as const,
    x: 100,
    z: 0,
    footprint: createRectFootprint(100, 0, 50, 70, 0),
    measuredWidth: 50,
    measuredDepth: 70,
    height: 30,
    floors: 8,
  };
  const blockingPond = {
    id: 'w-block',
    name: 'Пруд',
    kind: 'water' as const,
    polygon: createRectFootprint(100, 55, 44, 30, 0),
  };

  // No nearby streets -> direct off-road leg must detour around building & water!
  const walkDetour = computeStreetRoute(start, end, [], 'walk', 'scooter', [blockingBuilding], [blockingPond]);
  const pts = walkDetour.legs.flatMap((l) => l.points);
  assert.ok(pts.length >= 3, 'Detour path should contain intermediate waypoints around obstacle');
  const cutsThroughBuildingCenter = pts.some(
    (p) => p.x > 80 && p.x < 120 && p.z > -30 && p.z < 30
  );
  assert.equal(cutsThroughBuildingCenter, false, 'Route waypoints must not pass through building interior');
  // Detour length must exceed straight-line 200m
  assert.ok(
    walkDetour.totalDistanceBlocks > 210,
    `Detour distance should exceed 200m straight line, got ${walkDetour.totalDistanceBlocks}`
  );
});

test('Real MTR departures parser applies per-group deviation and scheduleSync aligns live vehicles & local routing times', () => {
  const depMap = parseDeparturesPayload({
    currentTime: Date.UTC(2026, 4, 10, 12, 0, 5),
    data: {
      cachedResponseTime: 1000,
      departures: [
        {
          id: 'r-sync',
          departures: [
            {
              deviation: 30_000, // +30s real schedule shift
              departures: [
                12 * 3600 * 1000, // 12:00:00 -> becomes 12:00:30 UTC
                12 * 3600 * 1000 + 300_000, // 12:05:00 -> becomes 12:05:30 UTC
              ],
            },
          ],
        },
      ],
    },
  });

  const info = depMap.get('r-sync');
  assert.ok(info, 'Departure info for r-sync must be parsed');
  assert.equal(info.departuresMs[0], 12 * 3600 * 1000 + 30_000);
  assert.equal(info.departuresMs[1], 12 * 3600 * 1000 + 330_000);

  // Sub-day server clock offset stays bounded within ±12h even if server year differs from real year
  const offsetFarFuture = extractServerClockOffsetMs(
    { currentTime: Date.UTC(2030, 8, 1, 12, 0, 15) },
    Date.UTC(2026, 4, 10, 12, 0, 0)
  );
  assert.equal(offsetFarFuture, 15_000);

  const sampleRoute = {
    id: 'r-sync',
    name: 'Линия 1',
    shortName: 'M1',
    number: 'M1',
    color: '#EF161E',
    kind: 'metro' as const,
    circular: false,
    headwaySec: 300,
    segmentDurationsMs: [60_000, 60_000],
    stops: [
      { stationId: 's1', name: 'Старт', x: 0, y: 50, z: 0, dwellMs: 10_000 },
      { stationId: 's2', name: 'Центр', x: 500, y: 50, z: 0, dwellMs: 10_000 },
      { stationId: 's3', name: 'Финиш', x: 1000, y: 50, z: 0, dwellMs: 10_000 },
    ],
  };

  // Passenger arrives at stop 0 at 12:00:00 UTC -> next train departs at 12:00:30 UTC (wait = 30s)
  const at1200 = Date.UTC(2026, 4, 10, 12, 0, 0);
  const nextDep = getNextDepartureWaitSec(sampleRoute, 0, at1200, info);
  assert.equal(nextDep.isScheduled, true);
  assert.equal(nextDep.waitSec, 30);
  assert.equal(nextDep.departureEpochMs, at1200 + 30_000);

  // At 12:01:00 UTC (30s after 12:00:30 departure), train is halfway between s1 and s2 (~progress 0.25)
  const vehicles = computeActiveVehiclesOnRoute(sampleRoute, at1200 + 60_000, info);
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].atStop, false);
  assert.ok(vehicles[0].progress01 > 0.15 && vehicles[0].progress01 < 0.35);

  // Route planner populates exact local departure & arrival timestamps consistent with user's local time
  const stations = sampleRoute.stops.map((st) => ({
    id: st.stationId,
    name: st.name,
    x: st.x,
    y: st.y,
    z: st.z,
    color: sampleRoute.color,
    kinds: ['metro' as const],
    routeIds: [sampleRoute.id],
  }));
  const routesOut = computeTransitRoutes(
    { label: 'Старт', x: 0, z: 0 },
    { label: 'Финиш', x: 1000, z: 0 },
    stations,
    [sampleRoute],
    [],
    [],
    [],
    at1200,
    depMap,
    0
  );
  assert.ok(routesOut.length >= 1);
  const best = routesOut[0];
  assert.equal(best.departureTimeMs, at1200);
  assert.ok((best.arrivalTimeMs ?? 0) > at1200);
  const transitLeg = best.legs.find((l) => l.type === 'transit');
  assert.ok(transitLeg);
  assert.equal(transitLeg.scheduledDeparture, true);
  assert.equal(transitLeg.waitSec, 30);
  assert.equal(transitLeg.departureTimeMs, at1200 + 30_000);

  // Local time helper round-trips HH:MM cleanly
  const customEpoch = parseLocalTimeInputToEpochMs('08:45', at1200);
  assert.equal(formatLocalTimeRu(customEpoch), '08:45');
});



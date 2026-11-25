import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAndSmoothRoadNetwork, synthesizeRoadsAndRailsFromMagic } from './roadMerger';
import type { MtrRoute, StreetSegment } from '../types/map';

test('mergeAndSmoothRoadNetwork merges two collinear end-to-end segments into one continuous road', () => {
  const s1: StreetSegment = {
    id: 'r1',
    name: 'Улица 1',
    district: 'Центр',
    roadClass: 'street',
    width: 14,
    simAllowed: true,
    points: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
    ],
  };
  const s2: StreetSegment = {
    id: 'r2',
    name: 'Улица 2',
    district: 'Центр',
    roadClass: 'street',
    width: 14,
    simAllowed: true,
    points: [
      { x: 108, z: 2 },
      { x: 220, z: 0 },
    ],
  };

  const merged = mergeAndSmoothRoadNetwork([s1, s2]);
  assert.equal(merged.length, 1, 'collinear segments with close endpoints must merge into 1');
  const pts = merged[0].points;
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  assert.ok(minX <= 5 && maxX >= 215, `merged road should span full trajectory, got [${minX}, ${maxX}]`);
});

test('mergeAndSmoothRoadNetwork collapses duplicate overlapping parallel corridors', () => {
  const main: StreetSegment = {
    id: 'm1',
    name: 'Проспект 1',
    district: 'Центр',
    roadClass: 'avenue',
    width: 20,
    simAllowed: true,
    points: [
      { x: 0, z: 0 },
      { x: 300, z: 0 },
    ],
  };
  const dup: StreetSegment = {
    id: 'm2',
    name: 'Проспект 2',
    district: 'Центр',
    roadClass: 'avenue',
    width: 18,
    simAllowed: true,
    points: [
      { x: 40, z: 4 },
      { x: 260, z: 3 },
    ],
  };

  const merged = mergeAndSmoothRoadNetwork([main, dup]);
  assert.equal(merged.length, 1, 'overlapping parallel duplicate corridor should collapse into 1');
});

test('mergeAndSmoothRoadNetwork keeps railway tracks separate from car roads', () => {
  const road: StreetSegment = {
    id: 'car-1',
    name: 'Автодорога',
    district: 'Центр',
    roadClass: 'street',
    width: 14,
    simAllowed: true,
    points: [
      { x: 0, z: 0 },
      { x: 200, z: 0 },
    ],
  };
  const rail: StreetSegment = {
    id: 'rail-1',
    name: 'ЖД путь',
    district: 'Центр',
    roadClass: 'railway',
    width: 8,
    simAllowed: false,
    points: [
      { x: 0, z: 2 },
      { x: 200, z: 2 },
    ],
  };

  const merged = mergeAndSmoothRoadNetwork([road, rail]);
  assert.equal(merged.length, 2, 'railway and street must not merge together');
  assert.ok(merged.some((s) => s.roadClass === 'railway'));
  assert.ok(merged.some((s) => s.roadClass === 'street'));
});

test('synthesizeRoadsAndRailsFromMagic synthesizes merged roads and railway tracks from MTR/MAGIC trajectories', () => {
  const bus1: MtrRoute = {
    id: 'bus-1',
    name: 'Автобус 1',
    shortName: '1',
    number: '1',
    color: '#2563EB',
    kind: 'bus',
    circular: false,
    headwaySec: 360,
    stops: [
      { stationId: 'a', name: 'A', x: 0, y: 64, z: 0, dwellMs: 15000 },
      { stationId: 'b', name: 'B', x: 250, y: 64, z: 0, dwellMs: 15000 },
    ],
    segmentDurationsMs: [40000],
  };
  const bus2: MtrRoute = {
    id: 'bus-2',
    name: 'Автобус 2',
    shortName: '2',
    number: '2',
    color: '#2563EB',
    kind: 'bus',
    circular: false,
    headwaySec: 360,
    stops: [
      { stationId: 'a', name: 'A', x: 10, y: 64, z: 3, dwellMs: 15000 },
      { stationId: 'b', name: 'B', x: 240, y: 64, z: 2, dwellMs: 15000 },
    ],
    segmentDurationsMs: [40000],
  };
  const railRoute: MtrRoute = {
    id: 'rail-1',
    name: 'Электричка 1',
    shortName: 'D1',
    number: 'D1',
    color: '#DC2626',
    kind: 'rail',
    circular: false,
    headwaySec: 600,
    stops: [
      { stationId: 'r1', name: 'Вокзал', x: 0, y: 66, z: 120, dwellMs: 20000 },
      { stationId: 'r2', name: 'Порт', x: 300, y: 66, z: 120, dwellMs: 20000 },
    ],
    segmentDurationsMs: [45000],
  };

  const result = synthesizeRoadsAndRailsFromMagic([bus1, bus2, railRoute], [], {
    includeRoads: true,
    includeRailways: true,
  });

  assert.equal(result.sourceMode, 'mtr-trajectories');
  assert.equal(result.roads.length, 1, 'shared bus corridors should merge into 1 smooth road');
  assert.equal(result.railways.length, 1, 'rail route should synthesize 1 railway segment');
  assert.equal(result.railways[0].roadClass, 'railway');
  assert.equal(result.railways[0].simAllowed, false);
});

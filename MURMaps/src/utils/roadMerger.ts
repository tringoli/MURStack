import type { MtrRoute, RoadClass, StreetSegment, WorldPoint, WorldPoint3D } from '../types/map';
import { getRoadHierarchyLevel, SERVER_GROUND_Y, smoothStreetPolyline } from './geometry';
import { inferDistrict } from './mtrParser';
import { pointToSegmentDistance } from './projection';
import {
  extractMagicRailPoints3D,
  getRouteIdsForMagicRail,
  normalizeMagicId,
  type MagicRailSegment,
} from './magicTracks';

function polylineLength(pts: WorldPoint[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return sum;
}

function dedupeClosePoints(pts: WorldPoint[], minGap = 2.5): WorldPoint[] {
  if (pts.length <= 2) return pts;
  const out: WorldPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].z - prev.z) >= minGap) {
      out.push(pts[i]);
    }
  }
  if (out.length === 1 && pts.length > 1) {
    out.push(pts[pts.length - 1]);
  }
  return out;
}

function rdpSimplify(pts: WorldPoint[], epsilon: number): WorldPoint[] {
  if (pts.length <= 2) return pts;
  let maxDist = 0;
  let splitIdx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegmentDistance(pts[i].x, pts[i].z, first.x, first.z, last.x, last.z);
    if (d > maxDist) {
      maxDist = d;
      splitIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, splitIdx + 1), epsilon);
    const right = rdpSimplify(pts.slice(splitIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function getEndpointTangent(pts: WorldPoint[], atEnd: boolean): { x: number; z: number } {
  if (pts.length < 2) return { x: 1, z: 0 };
  const anchor = atEnd ? pts[pts.length - 1] : pts[0];
  let ref = atEnd ? pts[pts.length - 2] : pts[1];
  // Walk back up to 24 blocks for stable tangent even on noisy micro-segments
  if (atEnd) {
    for (let i = pts.length - 2; i >= 0; i--) {
      ref = pts[i];
      if (Math.hypot(anchor.x - ref.x, anchor.z - ref.z) >= 18) break;
    }
    const dx = anchor.x - ref.x;
    const dz = anchor.z - ref.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  } else {
    for (let i = 1; i < pts.length; i++) {
      ref = pts[i];
      if (Math.hypot(ref.x - anchor.x, ref.z - anchor.z) >= 18) break;
    }
    const dx = ref.x - anchor.x;
    const dz = ref.z - anchor.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }
}

function nearestProjectionOnPolyline(
  pt: WorldPoint,
  poly: WorldPoint[]
): { dist: number; proj: WorldPoint; segIdx: number; tx: number; tz: number } {
  let bestDist = Infinity;
  let bestProj: WorldPoint = poly[0];
  let bestSeg = 0;
  let bestTx = 1;
  let bestTz = 0;

  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const t =
      lenSq < 1e-6 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / lenSq));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(pt.x - px, pt.z - pz);
    if (d < bestDist) {
      bestDist = d;
      bestProj = { x: px, z: pz };
      bestSeg = i;
      const len = Math.sqrt(lenSq) || 1;
      bestTx = dx / len;
      bestTz = dz / len;
    }
  }
  return { dist: bestDist, proj: bestProj, segIdx: bestSeg, tx: bestTx, tz: bestTz };
}

function resamplePolyline(pts: WorldPoint[], stepBlocks: number): WorldPoint[] {
  if (pts.length < 2) return pts;
  const out: WorldPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / stepBlocks));
    for (let s = 1; s <= steps; s++) {
      out.push({
        x: a.x + ((b.x - a.x) * s) / steps,
        z: a.z + ((b.z - a.z) * s) / steps,
      });
    }
  }
  return out;
}

function classesCanMerge(a: RoadClass, b: RoadClass): boolean {
  if (a === 'railway' || b === 'railway') return a === b;
  if (a === 'pedestrian' || b === 'pedestrian') return a === b;
  return Math.abs(getRoadHierarchyLevel(a) - getRoadHierarchyLevel(b)) <= 2;
}

function higherRoadClass(a: RoadClass, b: RoadClass): RoadClass {
  return getRoadHierarchyLevel(a) >= getRoadHierarchyLevel(b) ? a : b;
}

/**
 * Merges fragmented and overlapping roads/railways into clean, smooth, continuous trajectories:
 * 1. Collapses duplicate/parallel overlapping segments that share the same corridor (blending centerlines
 *    and trimming redundant overlaps cleanly at Y/T junctions).
 * 2. Iteratively stitches end-to-end collinear/smoothly aligned segments into long continuous roads.
 * 3. Snaps loose T-junction endpoints onto intersecting road centerlines and smooths final trajectories.
 */
export function mergeAndSmoothRoadNetwork(
  inputStreets: StreetSegment[],
  options: {
    endpointSnapBlocks?: number;
    corridorMergeFactor?: number;
    simplifyEpsilon?: number;
    smoothFillets?: boolean;
  } = {}
): StreetSegment[] {
  if (inputStreets.length <= 1) return inputStreets;

  const endpointSnapBase = options.endpointSnapBlocks ?? 22;
  const corridorMergeFactor = options.corridorMergeFactor ?? 0.65;
  const simplifyEpsilon = options.simplifyEpsilon ?? 4.5;
  const smoothFillets = options.smoothFillets ?? true;

  // Work on mutable copies sorted longest/widest first so major corridors absorb fragmented pieces
  let working: StreetSegment[] = inputStreets
    .filter((s) => s.points.length >= 2)
    .map((s) => ({
      ...s,
      points: dedupeClosePoints(s.points, 2),
    }))
    .filter((s) => polylineLength(s.points) >= 12);

  working.sort(
    (a, b) =>
      getRoadHierarchyLevel(b.roadClass) * 10000 +
      polylineLength(b.points) * b.width -
      (getRoadHierarchyLevel(a.roadClass) * 10000 + polylineLength(a.points) * a.width)
  );

  // PASS 1: Collapse overlapping / shared parallel road corridors & trim partial overlaps
  const absorbed = new Uint8Array(working.length);
  for (let i = 0; i < working.length; i++) {
    if (absorbed[i]) continue;
    const primary = working[i];

    for (let j = i + 1; j < working.length; j++) {
      if (absorbed[j]) continue;
      const cand = working[j];
      if (!classesCanMerge(primary.roadClass, cand.roadClass)) continue;
      if (Math.abs((primary.elevationY ?? SERVER_GROUND_Y) - (cand.elevationY ?? SERVER_GROUND_Y)) > 5) {
        continue;
      }

      const corridorTol = Math.max(
        10,
        (primary.width + cand.width) * 0.5 * corridorMergeFactor + 3
      );

      const sampled = resamplePolyline(cand.points, 12);
      const isSharedFlags: boolean[] = new Array(sampled.length).fill(false);
      let sharedCount = 0;

      for (let k = 0; k < sampled.length; k++) {
        const pt = sampled[k];
        const proj = nearestProjectionOnPolyline(pt, primary.points);
        if (proj.dist <= corridorTol) {
          // Verify roughly parallel direction (don't treat perpendicular crossing as shared corridor)
          const pPrev = sampled[Math.max(0, k - 1)];
          const pNext = sampled[Math.min(sampled.length - 1, k + 1)];
          const dx = pNext.x - pPrev.x;
          const dz = pNext.z - pPrev.z;
          const len = Math.hypot(dx, dz) || 1;
          const align = Math.abs((dx / len) * proj.tx + (dz / len) * proj.tz);
          if (align >= 0.68 || proj.dist <= corridorTol * 0.45) {
            isSharedFlags[k] = true;
            sharedCount++;
          }
        }
      }

      const overlapRatio = sharedCount / Math.max(1, sampled.length);
      if (overlapRatio >= 0.62) {
        // Candidate largely duplicates primary corridor -> absorb it!
        // Keep any meaningful non-overlapping head/tail extension by appending to primary if smooth
        absorbed[j] = 1;
        primary.width = Math.round(Math.max(primary.width, (primary.width * 2 + cand.width) / 3));
        primary.roadClass = higherRoadClass(primary.roadClass, cand.roadClass);

        // If candidate has a long non-overlapping tail/head (> 28 blocks), preserve that branch cleanly
        let runStart = -1;
        for (let k = 0; k <= sampled.length; k++) {
          const outside = k < sampled.length && !isSharedFlags[k];
          if (outside && runStart === -1) {
            runStart = k;
          } else if (!outside && runStart !== -1) {
            const segSlice = sampled.slice(Math.max(0, runStart - 1), Math.min(sampled.length, k + 1));
            if (polylineLength(segSlice) >= 28) {
              // Anchor junction end cleanly onto primary centerline
              const firstProj = nearestProjectionOnPolyline(segSlice[0], primary.points);
              if (firstProj.dist <= corridorTol * 1.4) {
                segSlice[0] = { x: Math.round(firstProj.proj.x), z: Math.round(firstProj.proj.z) };
              }
              const lastProj = nearestProjectionOnPolyline(
                segSlice[segSlice.length - 1],
                primary.points
              );
              if (lastProj.dist <= corridorTol * 1.4) {
                segSlice[segSlice.length - 1] = {
                  x: Math.round(lastProj.proj.x),
                  z: Math.round(lastProj.proj.z),
                };
              }
              working.push({
                ...cand,
                id: `${cand.id}-br${k}`,
                points: rdpSimplify(dedupeClosePoints(segSlice, 3), simplifyEpsilon),
              });
            }
            runStart = -1;
          }
        }
      } else if (sharedCount >= 2 && overlapRatio >= 0.2) {
        // Partial shared section (e.g. two bus routes sharing a 150m trunk before splitting):
        // Trim the overlapping section out of candidate and snap its split point cleanly to primary!
        const nonOverlapRuns: WorldPoint[][] = [];
        let runStart = -1;
        for (let k = 0; k <= sampled.length; k++) {
          const outside = k < sampled.length && !isSharedFlags[k];
          if (outside && runStart === -1) {
            runStart = k;
          } else if (!outside && runStart !== -1) {
            const slice = sampled.slice(Math.max(0, runStart - 1), Math.min(sampled.length, k + 1));
            if (polylineLength(slice) >= 22) {
              if (runStart > 0) {
                const p0 = nearestProjectionOnPolyline(slice[0], primary.points);
                slice[0] = { x: Math.round(p0.proj.x), z: Math.round(p0.proj.z) };
              }
              if (k < sampled.length) {
                const p1 = nearestProjectionOnPolyline(slice[slice.length - 1], primary.points);
                slice[slice.length - 1] = { x: Math.round(p1.proj.x), z: Math.round(p1.proj.z) };
              }
              nonOverlapRuns.push(rdpSimplify(dedupeClosePoints(slice, 3), simplifyEpsilon));
            }
            runStart = -1;
          }
        }
        if (nonOverlapRuns.length === 0) {
          absorbed[j] = 1;
        } else {
          cand.points = nonOverlapRuns[0];
          for (let r = 1; r < nonOverlapRuns.length; r++) {
            working.push({
              ...cand,
              id: `${cand.id}-sp${r}`,
              points: nonOverlapRuns[r],
            });
          }
        }
      }
    }
  }

  working = working.filter((_, idx) => !absorbed[idx] && working[idx].points.length >= 2);

  // PASS 2: Iterative end-to-end stitching of smooth continuous trajectories
  let mergedAny = true;
  let guard = 0;
  while (mergedAny && guard < 12) {
    mergedAny = false;
    guard++;

    for (let i = 0; i < working.length; i++) {
      const a = working[i];
      if (!a || a.points.length < 2) continue;

      let bestJ = -1;
      let bestScore = Infinity;
      let bestJoinMode: 'end-start' | 'end-end' | 'start-start' | 'start-end' = 'end-start';

      const aStart = a.points[0];
      const aEnd = a.points[a.points.length - 1];
      const aTanStart = getEndpointTangent(a.points, false); // pointing INTO a
      const aTanEnd = getEndpointTangent(a.points, true); // pointing OUT OF a

      for (let j = i + 1; j < working.length; j++) {
        const b = working[j];
        if (!b || b.points.length < 2) continue;
        if (!classesCanMerge(a.roadClass, b.roadClass)) continue;
        if (Math.abs((a.elevationY ?? SERVER_GROUND_Y) - (b.elevationY ?? SERVER_GROUND_Y)) > 5) {
          continue;
        }

        const maxSnap = Math.max(endpointSnapBase, (a.width + b.width) * 0.85);
        const bStart = b.points[0];
        const bEnd = b.points[b.points.length - 1];
        const bTanStart = getEndpointTangent(b.points, false); // pointing INTO b
        const bTanEnd = getEndpointTangent(b.points, true); // pointing OUT OF b

        const candidates: Array<{
          mode: 'end-start' | 'end-end' | 'start-start' | 'start-end';
          dist: number;
          dot: number;
        }> = [
          {
            mode: 'end-start',
            dist: Math.hypot(aEnd.x - bStart.x, aEnd.z - bStart.z),
            dot: aTanEnd.x * bTanStart.x + aTanEnd.z * bTanStart.z,
          },
          {
            mode: 'end-end',
            dist: Math.hypot(aEnd.x - bEnd.x, aEnd.z - bEnd.z),
            dot: aTanEnd.x * -bTanEnd.x + aTanEnd.z * -bTanEnd.z,
          },
          {
            mode: 'start-end',
            dist: Math.hypot(aStart.x - bEnd.x, aStart.z - bEnd.z),
            dot: bTanEnd.x * aTanStart.x + bTanEnd.z * aTanStart.z,
          },
          {
            mode: 'start-start',
            dist: Math.hypot(aStart.x - bStart.x, aStart.z - bStart.z),
            dot: -bTanStart.x * aTanStart.x + -bTanStart.z * aTanStart.z,
          },
        ];

        for (const c of candidates) {
          // Require smooth continuation (dot >= 0.65 => turn <= ~49 deg) or very tight junction (dot >= 0.35 when dist <= 8)
          const minDot = c.dist <= 8 ? 0.42 : 0.68;
          if (c.dist <= maxSnap && c.dot >= minDot) {
            const score = c.dist + (1 - c.dot) * 24;
            if (score < bestScore) {
              bestScore = score;
              bestJ = j;
              bestJoinMode = c.mode;
            }
          }
        }
      }

      if (bestJ !== -1) {
        const b = working[bestJ];
        let combinedPts: WorldPoint[];
        if (bestJoinMode === 'end-start') {
          combinedPts = [...a.points, ...b.points];
        } else if (bestJoinMode === 'end-end') {
          combinedPts = [...a.points, ...[...b.points].reverse()];
        } else if (bestJoinMode === 'start-end') {
          combinedPts = [...b.points, ...a.points];
        } else {
          combinedPts = [...[...b.points].reverse(), ...a.points];
        }

        const lenA = polylineLength(a.points);
        const lenB = polylineLength(b.points);
        const totalL = Math.max(1, lenA + lenB);

        a.points = rdpSimplify(dedupeClosePoints(combinedPts, 3), simplifyEpsilon * 0.85);
        a.width = Math.round((a.width * lenA + b.width * lenB) / totalL);
        a.roadClass = higherRoadClass(a.roadClass, b.roadClass);

        working.splice(bestJ, 1);
        mergedAny = true;
      }
    }
  }

  // PASS 3: Clean T-junction endpoint snapping + final simplification & corner smoothing
  for (let i = 0; i < working.length; i++) {
    const s = working[i];
    if (s.points.length < 2) continue;

    for (const endIdx of [0, s.points.length - 1]) {
      const ep = s.points[endIdx];
      let bestSnap: WorldPoint | null = null;
      let bestD = Math.max(14, s.width * 0.85);

      for (let j = 0; j < working.length; j++) {
        if (i === j) continue;
        const other = working[j];
        if (!classesCanMerge(s.roadClass, other.roadClass)) continue;
        const proj = nearestProjectionOnPolyline(ep, other.points);
        if (proj.dist > 1.5 && proj.dist < bestD) {
          bestD = proj.dist;
          bestSnap = { x: Math.round(proj.proj.x), z: Math.round(proj.proj.z) };
        }
      }

      if (bestSnap) {
        s.points[endIdx] = bestSnap;
      }
    }

    const simplified = rdpSimplify(dedupeClosePoints(s.points, 2.5), simplifyEpsilon);
    const radius =
      s.roadClass === 'railway'
        ? 34
        : s.roadClass === 'highway'
        ? 32
        : Math.max(14, Math.min(28, s.width * 1.15));
    s.points = smoothFillets
      ? smoothStreetPolyline(simplified, radius, 6)
      : simplified.map((p) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }));
  }

  return working.filter((s) => s.points.length >= 2 && polylineLength(s.points) >= 16);
}

export interface MagicTrajectorySynthesisOptions {
  includeRoads: boolean;
  includeRailways: boolean;
  /** Optional bounding crop; omit for full city network */
  cropBounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Optional arbitrary polygon boundary restricting synthesis strictly inside */
  cropPolygon?: WorldPoint[];
}

export interface MagicTrajectorySynthesisResult {
  roads: StreetSegment[];
  railways: StreetSegment[];
  allSegments: StreetSegment[];
  sourceMode: 'magic-rails' | 'mtr-trajectories';
}

function pointInPoly2D(x: number, z: number, poly: WorldPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function clipPolylineToZone(
  pts: WorldPoint3D[],
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number },
  polygon?: WorldPoint[]
): WorldPoint3D[][] {
  const usePoly = polygon && polygon.length >= 3;
  if (!usePoly && !bounds) return pts.length >= 2 ? [pts] : [];
  const runs: WorldPoint3D[][] = [];
  let cur: WorldPoint3D[] = [];
  const pad = 40;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const inside = usePoly
      ? pointInPoly2D(p.x, p.z, polygon)
      : bounds
      ? p.x >= bounds.minX - pad &&
        p.x <= bounds.maxX + pad &&
        p.z >= bounds.minZ - pad &&
        p.z <= bounds.maxZ + pad
      : true;
    if (inside) {
      cur.push(p);
    } else if (cur.length >= 2) {
      runs.push(cur);
      cur = [];
    } else {
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/**
 * Dedicated synthesis of Roads (for bus/trolleybus/surface corridors) and Railway Tracks
 * (for rail, tram, and surface/elevated metro lines) directly from MAGIC API rail curves
 * and/or MTR/JME 3D route trajectories, merging all shared corridors into smooth continuous lines.
 */
export function synthesizeRoadsAndRailsFromMagic(
  routes: MtrRoute[],
  magicRails: MagicRailSegment[],
  options: MagicTrajectorySynthesisOptions
): MagicTrajectorySynthesisResult {
  const rawRoads: StreetSegment[] = [];
  const rawRails: StreetSegment[] = [];

  const routeById = new Map<string, MtrRoute>();
  for (const r of routes) {
    routeById.set(normalizeMagicId(r.id), r);
  }

  let seq = 1;
  const usingPhysicalRails = magicRails.length > 0;

  if (usingPhysicalRails) {
    for (const rail of magicRails) {
      const pts3D = extractMagicRailPoints3D(rail);
      if (pts3D.length < 2) continue;

      const avgY = pts3D.reduce((s, p) => s + p.y, 0) / pts3D.length;
      const routeIds = getRouteIdsForMagicRail(rail);
      let hasRoadKind = false;
      let hasRailKind = false;
      let sampleName = '';

      for (const rId of routeIds) {
        const rt = routeById.get(rId);
        if (!rt) continue;
        if (!sampleName) sampleName = rt.name;
        if (rt.kind === 'bus' || rt.kind === 'trolleybus') {
          hasRoadKind = true;
        } else if (rt.kind === 'rail' || rt.kind === 'tram' || rt.kind === 'metro') {
          hasRailKind = true;
        }
      }

      // Untagged physical MAGIC rails default to railway tracks
      if (!hasRoadKind && !hasRailKind) {
        hasRailKind = true;
      }

      const clippedRuns = clipPolylineToZone(pts3D, options.cropBounds, options.cropPolygon);
      for (const run of clippedRuns) {
        const pts2D = run.map((p) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }));
        const mid = pts2D[Math.floor(pts2D.length / 2)];
        const district = inferDistrict(mid.x, mid.z);

        if (hasRoadKind && options.includeRoads) {
          const width = routeIds.length >= 4 ? 20 : routeIds.length >= 2 ? 16 : 12;
          const roadClass: RoadClass = width >= 19 ? 'avenue' : 'street';
          rawRoads.push({
            id: `magic-road-${seq++}`,
            name: sampleName ? `Магистраль (${sampleName.slice(0, 24)})` : `Дорога №${seq}`,
            district,
            roadClass,
            width,
            elevationY: Math.round(avgY),
            points: pts2D,
            simAllowed: true,
            isAutoSynthesized: true,
          });
        }

        if (hasRailKind && options.includeRailways) {
          // Skip very deep underground metro tunnels unless explicitly near/above surface
          if (avgY < SERVER_GROUND_Y - 12 && !routeIds.some((id) => routeById.get(id)?.kind === 'rail')) {
            continue;
          }
          rawRails.push({
            id: `magic-rail-${seq++}`,
            name: sampleName ? `ЖД линия (${sampleName.slice(0, 22)})` : `ЖД путь №${seq}`,
            district,
            roadClass: 'railway',
            width: 8,
            elevationY: Math.round(avgY),
            points: pts2D,
            simAllowed: false,
            isAutoSynthesized: true,
          });
        }
      }
    }
  } else {
    // Synthesize directly from live MTR/JME 3D route trajectories
    for (const route of routes) {
      if (route.stops.length < 2) continue;
      if (route.kind === 'boat' || route.kind === 'plane' || route.kind === 'cable') continue;

      const pts3D: WorldPoint3D[] =
        route.tracedPath3D && route.tracedPath3D.length >= 2
          ? route.tracedPath3D
          : route.stops.map((s) => ({ x: s.x, y: s.y, z: s.z }));

      const avgY = pts3D.reduce((s, p) => s + p.y, 0) / pts3D.length;
      const isRoadTransit = route.kind === 'bus' || route.kind === 'trolleybus';
      const isRailTransit =
        route.kind === 'rail' ||
        route.kind === 'tram' ||
        (route.kind === 'metro' && avgY >= SERVER_GROUND_Y - 8);

      const clippedRuns = clipPolylineToZone(pts3D, options.cropBounds, options.cropPolygon);
      for (const run of clippedRuns) {
        const pts2D = run.map((p) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }));
        const mid = pts2D[Math.floor(pts2D.length / 2)];
        const district = inferDistrict(mid.x, mid.z);

        if (isRoadTransit && options.includeRoads) {
          rawRoads.push({
            id: `magic-road-${seq++}`,
            name: `Проезд по трассе ${route.number || route.shortName}`,
            district,
            roadClass: route.kind === 'trolleybus' ? 'avenue' : 'street',
            width: route.kind === 'trolleybus' ? 18 : 14,
            elevationY: Math.round(avgY),
            points: pts2D,
            simAllowed: true,
            isAutoSynthesized: true,
          });
        }

        if (isRailTransit && options.includeRailways) {
          rawRails.push({
            id: `magic-rail-${seq++}`,
            name:
              route.kind === 'tram'
                ? `Трамвайные пути (${route.number})`
                : `ЖД пути (${route.number || route.shortName})`,
            district,
            roadClass: 'railway',
            width: route.kind === 'tram' ? 7 : 9,
            elevationY: Math.round(avgY),
            points: pts2D,
            simAllowed: false,
            isAutoSynthesized: true,
          });
        }
      }
    }
  }

  // Merge all overlapping/shared corridors into crisp, smooth continuous roads and railways!
  const mergedRoads = mergeAndSmoothRoadNetwork(rawRoads, {
    endpointSnapBlocks: 28,
    corridorMergeFactor: 0.72,
    simplifyEpsilon: 4.5,
    smoothFillets: true,
  }).map((r, idx) => ({
    ...r,
    id: `magic-road-m-${Date.now()}-${idx + 1}`,
    name: `${r.roadClass === 'avenue' ? 'Проспект' : 'Улица'} по трассе №${idx + 1}`,
  }));

  const mergedRailways = mergeAndSmoothRoadNetwork(rawRails, {
    endpointSnapBlocks: 26,
    corridorMergeFactor: 0.78,
    simplifyEpsilon: 3.8,
    smoothFillets: true,
  }).map((r, idx) => ({
    ...r,
    id: `magic-rail-m-${Date.now()}-${idx + 1}`,
    name: `ЖД путь №${idx + 1}`,
  }));

  return {
    roads: mergedRoads,
    railways: mergedRailways,
    allSegments: [...mergedRoads, ...mergedRailways],
    sourceMode: usingPhysicalRails ? 'magic-rails' : 'mtr-trajectories',
  };
}

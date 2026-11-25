import type { BuildingWing, CameraState, WorldPoint } from '../types/map';
import { SERVER_GROUND_Y } from './geometry';
import { pointToSegmentDistance } from './projection';
import type { WorldAABB } from './spatialIndex';

const DEG_TO_RAD = Math.PI / 180;

export interface BuildingWallSlice {
  a: WorldPoint;
  b: WorldPoint;
  outNx: number;
  outNz: number;
  minY: number;
  maxY: number;
  splitAtStart?: boolean;
  splitAtEnd?: boolean;
  continueBottom?: boolean;
  continueTop?: boolean;
}

export interface BuildingRenderSlicePlan {
  /** World base Y where this slice begins (raised above buried interiors for nested wings). */
  minY: number;
  /** World top Y where this slice ends. */
  maxY: number;
  /** True only on the topmost slice of a wing so roof fill, borders, accents & labels draw once. */
  drawRoof: boolean;
  /** Pre-clipped exposed vertical wall slices for this elevation band. */
  wallSlices: BuildingWallSlice[];
  /** World-space polygon representing this slice's active footprint for 2.5D depth sorting. */
  sortPoly: WorldPoint[];
  /** World AABB of this slice's active geometry. */
  aabb: WorldAABB;
}

export interface WingVolumeRef {
  id: string;
  footprint: WorldPoint[];
  baseY: number;
  roofY: number;
  aabb: WorldAABB;
}

export interface SortableBuildingSlice<T> {
  payload: T;
  sortPoly: WorldPoint[];
  minY: number;
  maxY: number;
  screenMinX: number;
  screenMaxX: number;
  screenMinY: number;
  screenMaxY: number;
}

interface CamPoint {
  rx: number;
  rz: number;
}

interface PreparedSortItem<T> {
  payload: T;
  poly: CamPoint[];
  minRx: number;
  maxRx: number;
  minRz: number;
  maxRz: number;
  centerRz: number;
  minY: number;
  maxY: number;
  screenMinX: number;
  screenMaxX: number;
  screenMinY: number;
  screenMaxY: number;
  origIndex: number;
}

function pointInWorldPoly(px: number, pz: number, poly: WorldPoint[]): boolean {
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
}

function pointStrictInsideWorldPoly(
  px: number,
  pz: number,
  poly: WorldPoint[],
  edgeTol: number
): boolean {
  if (!pointInWorldPoly(px, pz, poly)) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (pointToSegmentDistance(px, pz, a.x, a.z, b.x, b.z) <= edgeTol) {
      return false;
    }
  }
  return true;
}

function computeSignedAreaXZ(pts: WorldPoint[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum * 0.5;
}

function computePointsBounds(pts: WorldPoint[]): WorldAABB {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
  return { minX, maxX, minZ, maxZ };
}

function aabbOverlapsStrict(a: WorldAABB, b: WorldAABB, eps = 0.05): boolean {
  return !(
    a.maxX <= b.minX + eps ||
    a.minX >= b.maxX - eps ||
    a.maxZ <= b.minZ + eps ||
    a.minZ >= b.maxZ - eps
  );
}

/**
 * Returns true iff two world-space polygons have positive-area interior intersection
 * (not merely touching along a shared flush edge or corner vertex).
 */
export function polygonsStrictlyOverlapXZ(
  polyA: WorldPoint[],
  aabbA: WorldAABB,
  polyB: WorldPoint[],
  aabbB: WorldAABB
): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;
  if (!aabbOverlapsStrict(aabbA, aabbB, 0.08)) return false;

  const eps = 0.14;

  // 1. Check polygon centroids
  let cxA = 0;
  let czA = 0;
  for (let i = 0; i < polyA.length; i++) {
    cxA += polyA[i].x;
    czA += polyA[i].z;
  }
  cxA /= polyA.length;
  czA /= polyA.length;
  if (pointStrictInsideWorldPoly(cxA, czA, polyB, eps)) return true;

  let cxB = 0;
  let czB = 0;
  for (let i = 0; i < polyB.length; i++) {
    cxB += polyB[i].x;
    czB += polyB[i].z;
  }
  cxB /= polyB.length;
  czB /= polyB.length;
  if (pointStrictInsideWorldPoly(cxB, czB, polyA, eps)) return true;

  // 2. Check vertices strictly inside the other polygon
  for (let i = 0; i < polyA.length; i++) {
    if (pointStrictInsideWorldPoly(polyA[i].x, polyA[i].z, polyB, eps)) return true;
  }
  for (let i = 0; i < polyB.length; i++) {
    if (pointStrictInsideWorldPoly(polyB[i].x, polyB[i].z, polyA, eps)) return true;
  }

  // 3. Check inward-offset edge midpoints (catches concentric/shared-border overlaps where vertices lie on edges)
  const checkInwardProbes = (src: WorldPoint[], dst: WorldPoint[]): boolean => {
    const sign = computeSignedAreaXZ(src) >= 0 ? 1 : -1;
    for (let i = 0; i < src.length; i++) {
      const p0 = src[i];
      const p1 = src[(i + 1) % src.length];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      // Outward normal is (dz/len * sign, -dx/len * sign); inward is its negation
      const inNx = (-dz / len) * sign;
      const inNz = (dx / len) * sign;
      const mx = (p0.x + p1.x) * 0.5 + inNx * (eps * 1.4);
      const mz = (p0.z + p1.z) * 0.5 + inNz * (eps * 1.4);
      if (pointStrictInsideWorldPoly(mx, mz, dst, eps * 0.5)) return true;
    }
    return false;
  };
  if (checkInwardProbes(polyA, polyB) || checkInwardProbes(polyB, polyA)) return true;

  // 4. Check proper edge-edge crossings (handles cross '+' intersections where no vertex is inside the other!)
  for (let i = 0; i < polyA.length; i++) {
    const a = polyA[i];
    const b = polyA[(i + 1) % polyA.length];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    for (let j = 0; j < polyB.length; j++) {
      const c = polyB[j];
      const d = polyB[(j + 1) % polyB.length];
      const cdx = d.x - c.x;
      const cdz = d.z - c.z;
      const denom = abx * cdz - abz * cdx;
      if (Math.abs(denom) < 1e-6) continue;
      const qpx = c.x - a.x;
      const qpz = c.z - a.z;
      const t = (qpx * cdz - qpz * cdx) / denom;
      const u = (qpx * abz - qpz * abx) / denom;
      if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Subtracts a list of vertical occluder intervals `[oMin, oMax]` from `[minY, maxY]`,
 * returning remaining exposed vertical slices with height >= 0.15 blocks.
 */
function subtractVerticalIntervals(
  minY: number,
  maxY: number,
  occluders: Array<[number, number]>
): Array<[number, number]> {
  if (maxY - minY < 0.15) return [];
  if (occluders.length === 0) return [[minY, maxY]];

  const clipped: Array<[number, number]> = [];
  for (let i = 0; i < occluders.length; i++) {
    const lo = Math.max(minY, occluders[i][0]);
    const hi = Math.min(maxY, occluders[i][1]);
    if (hi > lo + 0.05) {
      clipped.push([lo, hi]);
    }
  }
  if (clipped.length === 0) return [[minY, maxY]];

  clipped.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [clipped[0]];
  for (let i = 1; i < clipped.length; i++) {
    const cur = clipped[i];
    const prev = merged[merged.length - 1];
    if (cur[0] <= prev[1] + 0.1) {
      if (cur[1] > prev[1]) prev[1] = cur[1];
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }

  const remaining: Array<[number, number]> = [];
  let cursor = minY;
  for (let i = 0; i < merged.length; i++) {
    const [oLo, oHi] = merged[i];
    if (oLo - cursor >= 0.15) {
      remaining.push([cursor, oLo]);
    }
    if (oHi > cursor) cursor = oHi;
  }
  if (maxY - cursor >= 0.15) {
    remaining.push([cursor, maxY]);
  }
  return remaining;
}

/**
 * Computes 2D monotone-chain convex hull of world points (used as tight sorting bounds for
 * sticking-out lower wall slices of partially overlapping wings).
 */
function computeConvexHullXZ(pts: WorldPoint[]): WorldPoint[] {
  if (pts.length <= 2) return pts;
  const sorted = [...pts].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.z - b.z));
  const unique: WorldPoint[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = unique[unique.length - 1];
    if (Math.abs(sorted[i].x - prev.x) > 1e-3 || Math.abs(sorted[i].z - prev.z) > 1e-3) {
      unique.push(sorted[i]);
    }
  }
  if (unique.length <= 2) return unique;

  const cross = (o: WorldPoint, a: WorldPoint, b: WorldPoint) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const lower: WorldPoint[] = [];
  for (let i = 0; i < unique.length; i++) {
    const p = unique[i];
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: WorldPoint[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 2 ? hull : unique;
}

/**
 * Computes exact vertically clipped wall slices and (when a taller wing partially overlaps
 * shorter wings' interiors) horizontal elevation render slices for a building wing.
 *
 * Guarantees:
 * 1) Nested spires/towers/penthouses inside wider lower bases ONLY emit vertical walls ABOVE
 *    the enclosing base's roof (never drawing buried lower shafts through the outer building!).
 * 2) Flush stepped wings clip the hidden lower portion of shared walls cleanly.
 * 3) Partially overlapping multi-height wings (e.g. '+' intersections or cantilevered towers)
 *    split cleanly at the shorter wing's roof elevation so lower outside walls and upper
 *    over-roof sections sort independently in 2.5D from all 360° camera bearings.
 */
export function computeWingRenderSlices(
  wing: BuildingWing,
  siblingWings: WingVolumeRef[],
  externalWings: WingVolumeRef[],
  buildingBaseY = SERVER_GROUND_Y
): BuildingRenderSlicePlan[] {
  const fp = wing.footprint;
  const n = fp.length;
  const wBaseY = wing.baseY ?? buildingBaseY;
  const wRoofY = wBaseY + Math.max(0, wing.height);
  const wAABB = computePointsBounds(fp);

  if (n < 3) {
    return [
      {
        minY: wBaseY,
        maxY: wRoofY,
        drawRoof: true,
        wallSlices: [],
        sortPoly: fp,
        aabb: wAABB,
      },
    ];
  }

  const normalSign = computeSignedAreaXZ(fp) >= 0 ? 1 : -1;

  // Filter to vertically overlapping neighbors whose AABBs touch/overlap this wing
  const relevantSiblings: WingVolumeRef[] = [];
  for (let i = 0; i < siblingWings.length; i++) {
    const sib = siblingWings[i];
    if (sib.id === wing.id || sib.footprint.length < 3) continue;
    if (sib.roofY <= wBaseY + 0.1 || sib.baseY >= wRoofY - 0.1) continue;
    if (
      sib.aabb.maxX < wAABB.minX - 0.8 ||
      sib.aabb.minX > wAABB.maxX + 0.8 ||
      sib.aabb.maxZ < wAABB.minZ - 0.8 ||
      sib.aabb.minZ > wAABB.maxZ + 0.8
    ) {
      continue;
    }
    relevantSiblings.push(sib);
  }

  const relevantExternals: WingVolumeRef[] = [];
  for (let i = 0; i < externalWings.length; i++) {
    const ext = externalWings[i];
    if (ext.id === wing.id || ext.footprint.length < 3) continue;
    if (ext.roofY <= wBaseY + 0.1 || ext.baseY >= wRoofY - 0.1) continue;
    if (!aabbOverlapsStrict(ext.aabb, wAABB, 0.1)) continue;
    relevantExternals.push(ext);
  }

  // Fast path: isolated single wing with no overlapping/touching neighbors
  if (relevantSiblings.length === 0 && relevantExternals.length === 0) {
    const wallSlices: BuildingWallSlice[] = [];
    for (let i = 0; i < n; i++) {
      const a = fp[i];
      const b = fp[(i + 1) % n];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      wallSlices.push({
        a,
        b,
        outNx: (dz / len) * normalSign,
        outNz: (-dx / len) * normalSign,
        minY: wBaseY,
        maxY: wRoofY,
      });
    }
    return [
      {
        minY: wBaseY,
        maxY: wRoofY,
        drawRoof: true,
        wallSlices,
        sortPoly: fp,
        aabb: wAABB,
      },
    ];
  }

  const allOccluders =
    relevantExternals.length > 0
      ? relevantSiblings.concat(relevantExternals)
      : relevantSiblings;
  const eps = 0.24;
  const allWallSlices: BuildingWallSlice[] = [];

  for (let i = 0; i < n; i++) {
    const a = fp[i];
    const b = fp[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const lenSq = len * len;
    const outNx = (dz / len) * normalSign;
    const outNz = (-dx / len) * normalSign;

    const splits: number[] = [0, 1];
    for (let pIdx = 0; pIdx < allOccluders.length; pIdx++) {
      const poly = allOccluders[pIdx].footprint;
      const m = poly.length;
      for (let j = 0; j < m; j++) {
        const c = poly[j];
        const d = poly[(j + 1) % m];

        const projT = ((c.x - a.x) * dx + (c.z - a.z) * dz) / lenSq;
        if (projT > 0.001 && projT < 0.999) {
          const px = a.x + projT * dx;
          const pz = a.z + projT * dz;
          if (Math.hypot(c.x - px, c.z - pz) <= eps * 1.6) {
            splits.push(projT);
          }
        }

        const cdx = d.x - c.x;
        const cdz = d.z - c.z;
        const denom = dx * cdz - dz * cdx;
        if (Math.abs(denom) > 1e-6) {
          const qpx = c.x - a.x;
          const qpz = c.z - a.z;
          const t = (qpx * cdz - qpz * cdx) / denom;
          const u = (qpx * dz - qpz * dx) / denom;
          if (t > 0.001 && t < 0.999 && u >= -0.02 && u <= 1.02) {
            splits.push(t);
          }
        }
      }
    }

    splits.sort((u, v) => u - v);
    const uniqueSplits: number[] = [splits[0]];
    for (let k = 1; k < splits.length; k++) {
      if (splits[k] - uniqueSplits[uniqueSplits.length - 1] > 1e-4) {
        uniqueSplits.push(splits[k]);
      }
    }

    const edgeSubIntervals: Array<{
      t0: number;
      t1: number;
      intervals: Array<[number, number]>;
    }> = [];

    for (let k = 0; k < uniqueSplits.length - 1; k++) {
      const t0 = uniqueSplits[k];
      const t1 = uniqueSplits[k + 1];
      if ((t1 - t0) * len < 0.08) continue;

      const tm = (t0 + t1) * 0.5;
      const mx = a.x + tm * dx;
      const mz = a.z + tm * dz;
      const probeOutX = mx + outNx * eps;
      const probeOutZ = mz + outNz * eps;

      const occIntervals: Array<[number, number]> = [];

      for (let sIdx = 0; sIdx < relevantSiblings.length; sIdx++) {
        const sib = relevantSiblings[sIdx];
        const poly = sib.footprint;
        if (
          pointInWorldPoly(probeOutX, probeOutZ, poly) ||
          pointStrictInsideWorldPoly(mx, mz, poly, eps * 0.6)
        ) {
          occIntervals.push([sib.baseY, sib.roofY]);
        }
      }

      // For separate buildings, only clip walls strictly inside the other building's interior
      for (let eIdx = 0; eIdx < relevantExternals.length; eIdx++) {
        const ext = relevantExternals[eIdx];
        const poly = ext.footprint;
        if (
          pointStrictInsideWorldPoly(mx, mz, poly, eps * 0.75) &&
          pointStrictInsideWorldPoly(probeOutX, probeOutZ, poly, eps * 0.5)
        ) {
          occIntervals.push([ext.baseY, ext.roofY]);
        }
      }

      const intervals = subtractVerticalIntervals(wBaseY, wRoofY, occIntervals);
      if (intervals.length > 0) {
        edgeSubIntervals.push({ t0, t1, intervals });
      }
    }

    for (let s = 0; s < edgeSubIntervals.length; s++) {
      const cur = edgeSubIntervals[s];
      const prev = s > 0 ? edgeSubIntervals[s - 1] : null;
      const next = s + 1 < edgeSubIntervals.length ? edgeSubIntervals[s + 1] : null;
      const pA = { x: a.x + cur.t0 * dx, z: a.z + cur.t0 * dz };
      const pB = { x: a.x + cur.t1 * dx, z: a.z + cur.t1 * dz };

      for (let iv = 0; iv < cur.intervals.length; iv++) {
        const [ivMin, ivMax] = cur.intervals[iv];
        const sharesPrev =
          prev !== null &&
          Math.abs(prev.t1 - cur.t0) < 1e-3 &&
          prev.intervals.some(([pLo, pHi]) => pHi > ivMin + 0.1 && pLo < ivMax - 0.1);
        const sharesNext =
          next !== null &&
          Math.abs(next.t0 - cur.t1) < 1e-3 &&
          next.intervals.some(([nLo, nHi]) => nHi > ivMin + 0.1 && nLo < ivMax - 0.1);

        allWallSlices.push({
          a: pA,
          b: pB,
          outNx,
          outNz,
          minY: ivMin,
          maxY: ivMax,
          splitAtStart: sharesPrev,
          splitAtEnd: sharesNext,
        });
      }
    }
  }

  let effectiveMinY = wBaseY;
  if (allWallSlices.length > 0) {
    let minSliceY = Infinity;
    for (let i = 0; i < allWallSlices.length; i++) {
      if (allWallSlices[i].minY < minSliceY) minSliceY = allWallSlices[i].minY;
    }
    if (Number.isFinite(minSliceY)) {
      effectiveMinY = minSliceY;
    }
  }

  // Check if this wing strictly overlaps the interior of any shorter neighbor whose roof
  // sits strictly between `effectiveMinY` and `wRoofY` (partial overlap multi-height case!).
  const rawCuts: number[] = [];
  for (let i = 0; i < allOccluders.length; i++) {
    const occ = allOccluders[i];
    if (occ.roofY <= effectiveMinY + 0.45 || occ.roofY >= wRoofY - 0.45) continue;
    if (polygonsStrictlyOverlapXZ(fp, wAABB, occ.footprint, occ.aabb)) {
      rawCuts.push(occ.roofY);
    }
  }

  if (rawCuts.length === 0) {
    return [
      {
        minY: effectiveMinY,
        maxY: wRoofY,
        drawRoof: true,
        wallSlices: allWallSlices,
        sortPoly: fp,
        aabb: wAABB,
      },
    ];
  }

  rawCuts.sort((a, b) => a - b);
  const cuts: number[] = [rawCuts[0]];
  for (let i = 1; i < rawCuts.length; i++) {
    if (rawCuts[i] - cuts[cuts.length - 1] > 0.4) {
      cuts.push(rawCuts[i]);
    }
  }

  const levels = [effectiveMinY, ...cuts, wRoofY];
  const plans: BuildingRenderSlicePlan[] = [];

  for (let bIdx = 0; bIdx < levels.length - 1; bIdx++) {
    const bMin = levels[bIdx];
    const bMax = levels[bIdx + 1];
    const isTopBand = bIdx === levels.length - 2;
    const bandWalls: BuildingWallSlice[] = [];

    for (let i = 0; i < allWallSlices.length; i++) {
      const ws = allWallSlices[i];
      const lo = Math.max(ws.minY, bMin);
      const hi = Math.min(ws.maxY, bMax);
      if (hi - lo < 0.12) continue;
      bandWalls.push({
        a: ws.a,
        b: ws.b,
        outNx: ws.outNx,
        outNz: ws.outNz,
        minY: lo,
        maxY: hi,
        splitAtStart: ws.splitAtStart,
        splitAtEnd: ws.splitAtEnd,
        continueBottom: ws.minY < bMin - 0.05,
        continueTop: ws.maxY > bMax + 0.05,
      });
    }

    if (!isTopBand && bandWalls.length === 0) continue;

    if (isTopBand) {
      plans.push({
        minY: bMin,
        maxY: bMax,
        drawRoof: true,
        wallSlices: bandWalls,
        sortPoly: fp,
        aabb: wAABB,
      });
    } else {
      // Group disconnected wall chains (e.g. north & south arms of a '+' cross intersection)
      // into separate render slices so each sticking-out arm sorts independently in 2.5D!
      const visited = new Uint8Array(bandWalls.length);
      const epsConnSq = 0.25 * 0.25;
      const ptsTouch = (p: WorldPoint, q: WorldPoint) => {
        const dx = p.x - q.x;
        const dz = p.z - q.z;
        return dx * dx + dz * dz <= epsConnSq;
      };

      for (let start = 0; start < bandWalls.length; start++) {
        if (visited[start]) continue;
        visited[start] = 1;
        const compWalls: BuildingWallSlice[] = [bandWalls[start]];
        const queue: number[] = [start];

        while (queue.length > 0) {
          const curIdx = queue.pop()!;
          const cw = bandWalls[curIdx];
          for (let j = 0; j < bandWalls.length; j++) {
            if (visited[j]) continue;
            const ow = bandWalls[j];
            if (
              ptsTouch(cw.a, ow.a) ||
              ptsTouch(cw.a, ow.b) ||
              ptsTouch(cw.b, ow.a) ||
              ptsTouch(cw.b, ow.b)
            ) {
              visited[j] = 1;
              compWalls.push(ow);
              queue.push(j);
            }
          }
        }

        const pts: WorldPoint[] = [];
        for (let i = 0; i < compWalls.length; i++) {
          pts.push(compWalls[i].a, compWalls[i].b);
        }
        const hull = computeConvexHullXZ(pts);
        const sortPoly = hull.length >= 2 ? hull : fp;
        plans.push({
          minY: bMin,
          maxY: bMax,
          drawRoof: false,
          wallSlices: compWalls,
          sortPoly,
          aabb: computePointsBounds(sortPoly),
        });
      }
    }
  }

  return plans.length > 0
    ? plans
    : [
        {
          minY: effectiveMinY,
          maxY: wRoofY,
          drawRoof: true,
          wallSlices: allWallSlices,
          sortPoly: fp,
          aabb: wAABB,
        },
      ];
}

/**
 * Intersects vertical camera-space line `X = rx` with closed polygon (or 2-point segment)
 * and returns its `[minRz, maxRz]` depth span, or `null` if the line misses the polygon.
 */
function polygonRzRangeAtRx(poly: CamPoint[], rx: number): [number, number] | null {
  const n = poly.length;
  if (n < 2) return null;
  let minRz = Infinity;
  let maxRz = -Infinity;
  const edgeCount = n === 2 ? 1 : n;

  for (let i = 0; i < edgeCount; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const dx = p2.rx - p1.rx;
    if (Math.abs(dx) < 1e-6) {
      if (Math.abs(rx - p1.rx) < 1e-5) {
        if (p1.rz < minRz) minRz = p1.rz;
        if (p1.rz > maxRz) maxRz = p1.rz;
        if (p2.rz < minRz) minRz = p2.rz;
        if (p2.rz > maxRz) maxRz = p2.rz;
      }
      continue;
    }
    const minEdgeX = p1.rx < p2.rx ? p1.rx : p2.rx;
    const maxEdgeX = p1.rx > p2.rx ? p1.rx : p2.rx;
    if (rx >= minEdgeX - 1e-6 && rx <= maxEdgeX + 1e-6) {
      const t = Math.max(0, Math.min(1, (rx - p1.rx) / dx));
      const rz = p1.rz + t * (p2.rz - p1.rz);
      if (rz < minRz) minRz = rz;
      if (rz > maxRz) maxRz = rz;
    }
  }

  return minRz <= maxRz ? [minRz, maxRz] : null;
}

/**
 * Exact 2.5D occlusion comparison between two screen-overlapping building slices `a` and `b`.
 * Returns:
 *   -1 if `a` MUST be drawn BEFORE `b` (`b` occludes `a`)
 *   +1 if `b` MUST be drawn BEFORE `a` (`a` occludes `b`)
 *    0 if there is no strict directional occlusion constraint
 */
function compareSliceOcclusion<T>(a: PreparedSortItem<T>, b: PreparedSortItem<T>): -1 | 0 | 1 {
  // Fast path: horizontal rx intervals overlap -> perform exact vertical scanline depth test
  const ovMinRx = a.minRx > b.minRx ? a.minRx : b.minRx;
  const ovMaxRx = a.maxRx < b.maxRx ? a.maxRx : b.maxRx;

  if (ovMaxRx - ovMinRx > 0.04) {
    // Fast disjoint-rz AABB check (no XZ overlap possible when rz intervals are separated)
    if (a.maxRz <= b.minRz + 0.05) return -1;
    if (b.maxRz <= a.minRz + 0.05) return 1;

    // Collect critical rx coordinates inside [ovMinRx, ovMaxRx]
    const xs: number[] = [ovMinRx, ovMaxRx];
    for (let i = 0; i < a.poly.length; i++) {
      const rx = a.poly[i].rx;
      if (rx > ovMinRx + 1e-4 && rx < ovMaxRx - 1e-4) xs.push(rx);
    }
    for (let i = 0; i < b.poly.length; i++) {
      const rx = b.poly[i].rx;
      if (rx > ovMinRx + 1e-4 && rx < ovMaxRx - 1e-4) xs.push(rx);
    }
    xs.sort((u, v) => u - v);

    let aBehindSpan = 0;
    let bBehindSpan = 0;
    let overlapSpan = 0;

    for (let k = 0; k < xs.length - 1; k++) {
      const span = xs[k + 1] - xs[k];
      if (span < 1e-3) continue;
      const midRx = (xs[k] + xs[k + 1]) * 0.5;
      const ra = polygonRzRangeAtRx(a.poly, midRx);
      const rb = polygonRzRangeAtRx(b.poly, midRx);
      if (!ra || !rb) continue;

      if (ra[1] <= rb[0] + 0.08) {
        aBehindSpan += span;
      } else if (rb[1] <= ra[0] + 0.08) {
        bBehindSpan += span;
      } else {
        overlapSpan += span;
      }
    }

    // Rule 1: Vertical stacking takes strict priority when footprints overlap in XZ
    if (overlapSpan > 0.02) {
      if (b.minY >= a.maxY - 0.15) return -1;
      if (a.minY >= b.maxY - 0.15) return 1;
    }

    // Rule 2: Exact camera-ray separation along shared rx columns
    if (aBehindSpan > 0.01 && bBehindSpan <= 0.01) return -1;
    if (bBehindSpan > 0.01 && aBehindSpan <= 0.01) return 1;
    if (aBehindSpan > 0.01 && bBehindSpan > 0.01) {
      return aBehindSpan >= bBehindSpan ? -1 : 1;
    }

    // Rule 3: Same-elevation overlapping footprints (e.g. same-height merged wings)
    if (overlapSpan > 0.02) {
      if (Math.abs(a.maxY - b.maxY) > 0.15) return a.maxY < b.maxY ? -1 : 1;
      if (Math.abs(a.minY - b.minY) > 0.15) return a.minY < b.minY ? -1 : 1;
      if (Math.abs(a.centerRz - b.centerRz) > 0.05) return a.centerRz < b.centerRz ? -1 : 1;
    }
    return 0;
  }

  // Disjoint rx intervals (can still slightly overlap on screen due to perspective slant at edges)
  if (a.maxRz <= b.minRz + 0.05) return -1;
  if (b.maxRz <= a.minRz + 0.05) return 1;
  return 0;
}

/**
 * Min-heap for deterministic topological sort tie-breaking:
 * prefers lower elevation band first, then farther camera depth (`centerRz`), then original index.
 */
class SliceMinHeap {
  private readonly data: number[] = [];
  private readonly keysA: Float64Array;
  private readonly keysB: Float64Array;

  constructor(keysA: Float64Array, keysB: Float64Array) {
    this.keysA = keysA;
    this.keysB = keysB;
  }

  get size(): number {
    return this.data.length;
  }

  private less(i: number, j: number): boolean {
    const a1 = this.keysA[i];
    const a2 = this.keysA[j];
    if (Math.abs(a1 - a2) > 0.25) return a1 < a2;
    const b1 = this.keysB[i];
    const b2 = this.keysB[j];
    if (b1 !== b2) return b1 < b2;
    return i < j;
  }

  push(idx: number): void {
    const d = this.data;
    d.push(idx);
    let pos = d.length - 1;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (this.less(d[pos], d[parent])) {
        const tmp = d[pos];
        d[pos] = d[parent];
        d[parent] = tmp;
        pos = parent;
      } else {
        break;
      }
    }
  }

  pop(): number {
    const d = this.data;
    const top = d[0];
    const last = d.pop()!;
    if (d.length > 0) {
      d[0] = last;
      let pos = 0;
      const len = d.length;
      while (true) {
        let smallest = pos;
        const left = (pos << 1) + 1;
        const right = left + 1;
        if (left < len && this.less(d[left], d[smallest])) smallest = left;
        if (right < len && this.less(d[right], d[smallest])) smallest = right;
        if (smallest === pos) break;
        const tmp = d[pos];
        d[pos] = d[smallest];
        d[smallest] = tmp;
        pos = smallest;
      }
    }
    return top;
  }
}

/**
 * Sorts visible 2.5D building slices in exact back-to-front painter's order using
 * sweep-and-prune screen-box culling + exact camera-ray visibility DAG + Kahn topological sort.
 *
 * Complexity: O(N log N + E) where E is only the small number of screen-overlapping pairs.
 * Guaranteed to terminate cleanly and emit every slice even if cyclic overlaps exist.
 */
export function sortBuildingRenderSlices<T>(
  items: SortableBuildingSlice<T>[],
  camera: CameraState
): T[] {
  const n = items.length;
  if (n === 0) return [];
  if (n === 1) return [items[0].payload];

  const radBearing = -camera.bearing * DEG_TO_RAD;
  const cosB = Math.cos(radBearing);
  const sinB = Math.sin(radBearing);

  const prepared: PreparedSortItem<T>[] = new Array(n);
  const tieMinY = new Float64Array(n);
  const tieCenterRz = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const it = items[i];
    const sp = it.sortPoly;
    const m = sp.length;
    const poly: CamPoint[] = new Array(m);
    let minRx = Infinity;
    let maxRx = -Infinity;
    let minRz = Infinity;
    let maxRz = -Infinity;
    let sumRz = 0;

    for (let k = 0; k < m; k++) {
      const dx = sp[k].x - camera.x;
      const dz = sp[k].z - camera.z;
      const rx = dx * cosB - dz * sinB;
      const rz = dx * sinB + dz * cosB;
      poly[k] = { rx, rz };
      if (rx < minRx) minRx = rx;
      if (rx > maxRx) maxRx = rx;
      if (rz < minRz) minRz = rz;
      if (rz > maxRz) maxRz = rz;
      sumRz += rz;
    }

    const centerRz = m > 0 ? sumRz / m : 0;
    prepared[i] = {
      payload: it.payload,
      poly,
      minRx,
      maxRx,
      minRz,
      maxRz,
      centerRz,
      minY: it.minY,
      maxY: it.maxY,
      screenMinX: it.screenMinX,
      screenMaxX: it.screenMaxX,
      screenMinY: it.screenMinY,
      screenMaxY: it.screenMaxY,
      origIndex: i,
    };
    tieMinY[i] = it.minY;
    tieCenterRz[i] = centerRz;
  }

  // Sweep-and-prune by screenMinX to find only truly screen-overlapping pairs
  const sweepOrder = new Array<number>(n);
  for (let i = 0; i < n; i++) sweepOrder[i] = i;
  sweepOrder.sort((ia, ib) => prepared[ia].screenMinX - prepared[ib].screenMinX);

  const adj: number[][] = new Array(n);
  const inDegree = new Int32Array(n);
  for (let i = 0; i < n; i++) adj[i] = [];

  for (let s = 0; s < n; s++) {
    const i = sweepOrder[s];
    const a = prepared[i];
    const aMaxX = a.screenMaxX;

    for (let t = s + 1; t < n; t++) {
      const j = sweepOrder[t];
      const b = prepared[j];
      if (b.screenMinX >= aMaxX - 0.5) break;
      if (b.screenMaxY <= a.screenMinY + 0.5 || a.screenMaxY <= b.screenMinY + 0.5) {
        continue;
      }

      const cmp = compareSliceOcclusion(a, b);
      if (cmp < 0) {
        adj[i].push(j);
        inDegree[j]++;
      } else if (cmp > 0) {
        adj[j].push(i);
        inDegree[i]++;
      }
    }
  }

  // Kahn's topological sort with deterministic min-heap tie-breaking & graceful cycle breaking
  const heap = new SliceMinHeap(tieMinY, tieCenterRz);
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) heap.push(i);
  }

  const emitted = new Uint8Array(n);
  const result: T[] = new Array(n);
  let outCount = 0;

  while (outCount < n) {
    if (heap.size === 0) {
      // Break rare cycle cleanly by picking the lowest/farthest remaining slice
      let bestIdx = -1;
      for (let i = 0; i < n; i++) {
        if (emitted[i]) continue;
        if (
          bestIdx === -1 ||
          (Math.abs(tieMinY[i] - tieMinY[bestIdx]) > 0.25
            ? tieMinY[i] < tieMinY[bestIdx]
            : tieCenterRz[i] < tieCenterRz[bestIdx])
        ) {
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;
      heap.push(bestIdx);
    }

    const u = heap.pop();
    if (emitted[u]) continue;
    emitted[u] = 1;
    result[outCount++] = prepared[u].payload;

    const neighbors = adj[u];
    for (let k = 0; k < neighbors.length; k++) {
      const v = neighbors[k];
      if (emitted[v]) continue;
      inDegree[v]--;
      if (inDegree[v] <= 0) {
        heap.push(v);
      }
    }
  }

  return result;
}

import type {
  Building3D,
  BuildingWing,
  CameraState,
  LandFeature,
  MtrRoute,
  MtrStation,
  StreetSegment,
  WorldPoint,
  WorldPoint3D,
} from '../types/map';
import { screenToWorld } from './projection';
import { getRoadHierarchyLevel, SERVER_GROUND_Y, smoothStreetPolyline } from './geometry';
import {
  clipFootprintEdgesAgainstOccluders,
  computeBuildingLabelAnchor,
  computeWingExposedEdges,
  getBuildingWings,
  type BuildingLabelAnchor,
  type ExposedWingEdge,
} from './buildingOps';
import {
  computeWingRenderSlices,
  type BuildingRenderSlicePlan,
  type WingVolumeRef,
} from './buildingRenderSort';

export interface WorldAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function aabbIntersects(a: WorldAABB, b: WorldAABB): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

export function computePointsAABB(pts: Array<{ x: number; z: number }>, pad = 0): WorldAABB {
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
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minZ: minZ - pad,
    maxZ: maxZ + pad,
  };
}

/**
 * Computes the world-space axis-aligned bounding box visible in the current viewport,
 * accounting for 3D pitch foreshortening, bearing rotation, and extra pixel padding
 * for tall extruded buildings and street labels near the edges.
 */
export function computeViewportWorldBounds(
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  padPx = 120
): WorldAABB {
  const w = Math.max(1, viewportWidth);
  const h = Math.max(1, viewportHeight);

  // Sample 4 corners + top/bottom edge midpoints for accurate frustum enclosure under bearing+pitch
  const sampleCoords: Array<[number, number]> = [
    [-padPx, -padPx],
    [w * 0.5, -padPx],
    [w + padPx, -padPx],
    [-padPx, h + padPx],
    [w * 0.5, h + padPx],
    [w + padPx, h + padPx],
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < sampleCoords.length; i++) {
    const [sx, sy] = sampleCoords[i];
    const wp = screenToWorld(sx, sy, camera, w, h);
    if (wp.x < minX) minX = wp.x;
    if (wp.x > maxX) maxX = wp.x;
    if (wp.z < minZ) minZ = wp.z;
    if (wp.z > maxZ) maxZ = wp.z;
  }

  return { minX, maxX, minZ, maxZ };
}

interface GridEntry<T> {
  item: T;
  bounds: WorldAABB;
  stamp: number;
}

/**
 * Zero-allocation-per-query uniform spatial grid hash index (like modern vector map tiles).
 * Enables O(visible) rendering and O(1) hit-testing even with 10,000+ buildings/streets on mobile.
 */
export class UniformGridIndex<T> {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, GridEntry<T>[]>();
  private readonly entries: GridEntry<T>[] = [];
  private queryStamp = 0;

  constructor(cellSize = 256) {
    this.cellSize = Math.max(16, cellSize);
  }

  get size(): number {
    return this.entries.length;
  }

  insert(item: T, bounds: WorldAABB): void {
    const entry: GridEntry<T> = { item, bounds, stamp: 0 };
    this.entries.push(entry);

    const minCx = Math.floor(bounds.minX / this.cellSize);
    const maxCx = Math.floor(bounds.maxX / this.cellSize);
    const minCz = Math.floor(bounds.minZ / this.cellSize);
    const maxCz = Math.floor(bounds.maxZ / this.cellSize);

    // Guard against huge features spanning hundreds of cells
    const spanX = maxCx - minCx + 1;
    const spanZ = maxCz - minCz + 1;
    if (spanX * spanZ > 1200) {
      // Fall back to coarse step insert or single fallback bucket
      let large = this.buckets.get('__large__');
      if (!large) {
        large = [];
        this.buckets.set('__large__', large);
      }
      large.push(entry);
      return;
    }

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = `${cx},${cz}`;
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = [];
          this.buckets.set(key, bucket);
        }
        bucket.push(entry);
      }
    }
  }

  queryAABB(bounds: WorldAABB, out: T[] = []): T[] {
    out.length = 0;
    if (this.entries.length === 0) return out;

    const minCx = Math.floor(bounds.minX / this.cellSize);
    const maxCx = Math.floor(bounds.maxX / this.cellSize);
    const minCz = Math.floor(bounds.minZ / this.cellSize);
    const maxCz = Math.floor(bounds.maxZ / this.cellSize);

    // If viewport spans a huge number of cells (very far zoomed out), direct scan is faster than hashing empty cells
    const cellCount = (maxCx - minCx + 1) * (maxCz - minCz + 1);
    if (cellCount > this.entries.length * 1.5 || cellCount > 2400) {
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i];
        if (aabbIntersects(e.bounds, bounds)) {
          out.push(e.item);
        }
      }
      return out;
    }

    const stamp = ++this.queryStamp;

    const large = this.buckets.get('__large__');
    if (large) {
      for (let i = 0; i < large.length; i++) {
        const e = large[i];
        if (e.stamp !== stamp && aabbIntersects(e.bounds, bounds)) {
          e.stamp = stamp;
          out.push(e.item);
        }
      }
    }

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets.get(`${cx},${cz}`);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i];
          if (e.stamp !== stamp && aabbIntersects(e.bounds, bounds)) {
            e.stamp = stamp;
            out.push(e.item);
          }
        }
      }
    }
    return out;
  }

  queryPoint(x: number, z: number, radius: number, out: T[] = []): T[] {
    return this.queryAABB(
      {
        minX: x - radius,
        maxX: x + radius,
        minZ: z - radius,
        maxZ: z + radius,
      },
      out
    );
  }
}

export interface ScreenBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Clips a 2D screen-space line segment `(x0, y0) -> (x1, y1)` against an axis-aligned
 * viewport rectangle `[minX, maxX] x [minY, maxY]` using Liang-Barsky clipping.
 * Prevents off-screen polylines (e.g. 35km regional rail routes at high zoom) from
 * rasterizing tens of thousands of off-screen dashes.
 */
export function clipScreenSegmentToBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { ax: number; ay: number; bx: number; by: number } | null {
  if (
    (x0 < minX && x1 < minX) ||
    (x0 > maxX && x1 > maxX) ||
    (y0 < minY && y1 < minY) ||
    (y0 > maxY && y1 > maxY)
  ) {
    return null;
  }
  if (
    x0 >= minX &&
    x0 <= maxX &&
    x1 >= minX &&
    x1 <= maxX &&
    y0 >= minY &&
    y0 <= maxY &&
    y1 >= minY &&
    y1 <= maxY
  ) {
    return { ax: x0, ay: y0, bx: x1, by: y1 };
  }

  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;

  const clipEdge = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    !clipEdge(-dx, x0 - minX) ||
    !clipEdge(dx, maxX - x0) ||
    !clipEdge(-dy, y0 - minY) ||
    !clipEdge(dy, maxY - y0)
  ) {
    return null;
  }

  return {
    ax: x0 + t0 * dx,
    ay: y0 + t0 * dy,
    bx: x0 + t1 * dx,
    by: y0 + t1 * dy,
  };
}

export interface PolylinePathCommand {
  op: 'M' | 'L';
  x: number;
  y: number;
}

/**
 * Converts a sequence of screen-space polyline points into clipped moveTo/lineTo
 * commands against `[minX, maxX] x [minY, maxY]`, always emitting an initial `M`
 * command before the first visible segment so the starting segment is never dropped.
 */
export function buildClippedPolylinePathCommands(
  screenPts: Array<{ sx: number; sy: number }>,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): PolylinePathCommand[] {
  const cmds: PolylinePathCommand[] = [];
  if (screenPts.length < 2) return cmds;
  let hasSegment = false;
  let lastX = 0;
  let lastY = 0;
  for (let i = 1; i < screenPts.length; i++) {
    const prevP = screenPts[i - 1];
    const p = screenPts[i];
    const clipped = clipScreenSegmentToBox(
      prevP.sx,
      prevP.sy,
      p.sx,
      p.sy,
      minX,
      minY,
      maxX,
      maxY
    );
    if (clipped) {
      if (
        !hasSegment ||
        Math.abs(clipped.ax - lastX) > 0.25 ||
        Math.abs(clipped.ay - lastY) > 0.25
      ) {
        cmds.push({ op: 'M', x: clipped.ax, y: clipped.ay });
      }
      cmds.push({ op: 'L', x: clipped.bx, y: clipped.by });
      lastX = clipped.bx;
      lastY = clipped.by;
      hasSegment = true;
    }
  }
  return cmds;
}

/**
 * Fast O(1) screen-space label & symbol collision grid (replaces O(K^2) placedLabels.some scans).
 * Supports non-mutating `canPlace` queries, multi-anchor `tryPlaceWithCandidates`, and explicit `reserve`.
 */
export class ScreenLabelGrid {
  private readonly cellW: number;
  private readonly cellH: number;
  private readonly buckets = new Map<number, ScreenBox[]>();

  constructor(cellW = 96, cellH = 32) {
    this.cellW = cellW;
    this.cellH = cellH;
  }

  clear(): void {
    this.buckets.clear();
  }

  canPlace(x1: number, y1: number, x2: number, y2: number): boolean {
    const cMinX = Math.floor(x1 / this.cellW);
    const cMaxX = Math.floor(x2 / this.cellW);
    const cMinY = Math.floor(y1 / this.cellH);
    const cMaxY = Math.floor(y2 / this.cellH);

    for (let cy = cMinY; cy <= cMaxY; cy++) {
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        const b = this.buckets.get(cy * 4096 + cx);
        if (!b) continue;
        for (let i = 0; i < b.length; i++) {
          const box = b[i];
          if (!(x2 < box.x1 || x1 > box.x2 || y2 < box.y1 || y1 > box.y2)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  reserve(x1: number, y1: number, x2: number, y2: number): void {
    const cMinX = Math.floor(x1 / this.cellW);
    const cMaxX = Math.floor(x2 / this.cellW);
    const cMinY = Math.floor(y1 / this.cellH);
    const cMaxY = Math.floor(y2 / this.cellH);
    const box: ScreenBox = { x1, y1, x2, y2 };

    for (let cy = cMinY; cy <= cMaxY; cy++) {
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        const key = cy * 4096 + cx;
        let b = this.buckets.get(key);
        if (!b) {
          b = [];
          this.buckets.set(key, b);
        }
        b.push(box);
      }
    }
  }

  tryPlace(x1: number, y1: number, x2: number, y2: number, force = false): boolean {
    if (!force && !this.canPlace(x1, y1, x2, y2)) {
      return false;
    }
    this.reserve(x1, y1, x2, y2);
    return true;
  }

  /**
   * Tries an ordered list of candidate bounding boxes (e.g. Right, Left, Above, Below an icon)
   * and reserves the first candidate that does not collide. Returns the winning candidate index or -1.
   */
  tryPlaceWithCandidates(candidates: ScreenBox[], force = false): number {
    if (candidates.length === 0) return -1;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (this.canPlace(c.x1, c.y1, c.x2, c.y2)) {
        this.reserve(c.x1, c.y1, c.x2, c.y2);
        return i;
      }
    }
    if (force) {
      const c = candidates[0];
      this.reserve(c.x1, c.y1, c.x2, c.y2);
      return 0;
    }
    return -1;
  }
}

export interface IconLabelCandidate {
  box: ScreenBox;
  tx: number;
  ty: number;
  align: CanvasTextAlign;
}

/**
 * Generates 8 cartographic label placement candidates around an icon at `(cx, cy)` whose
 * reserved collision box is `[cx - (halfIconW + iconPad), cy - (halfIconH + iconPad)] ..
 * [cx + (halfIconW + iconPad), cy + (halfIconH + iconPad)]`.
 *
 * Every candidate box is guaranteed to lie STRICTLY outside the icon's own reserved box
 * (separated by `boxClearance >= 1.5px`) so a station or POI label can NEVER self-collide
 * with its own emblem!
 */
export function buildIconLabelCandidates(
  cx: number,
  cy: number,
  halfIconW: number,
  halfIconH: number,
  iconPad: number,
  textW: number,
  halfTextH: number
): IconLabelCandidate[] {
  const padW = halfIconW + Math.max(0, iconPad);
  const padH = halfIconH + Math.max(0, iconPad);
  const clear = 1.5;
  const textGap = Math.max(3.5, iconPad + 1.5);
  const rightTx = cx + halfIconW + textGap;
  const rightX1 = Math.max(cx + padW + clear, rightTx - 1);
  const rightX2 = Math.max(rightX1 + 4, rightTx + textW + 3);
  const leftTx = cx - halfIconW - textGap;
  const leftX2 = Math.min(cx - padW - clear, leftTx + 1);
  const leftX1 = Math.min(leftX2 - 4, leftTx - textW - 3);
  const aboveY2 = cy - padH - clear;
  const aboveY1 = aboveY2 - halfTextH * 2;
  const belowY1 = cy + padH + clear;
  const belowY2 = belowY1 + halfTextH * 2;
  const diagShiftY = halfTextH + 1;

  return [
    // 0: Right of icon (primary cartographic preference)
    {
      box: { x1: rightX1, y1: cy - halfTextH, x2: rightX2, y2: cy + halfTextH },
      tx: rightTx,
      ty: cy,
      align: 'left',
    },
    // 1: Left of icon
    {
      box: { x1: leftX1, y1: cy - halfTextH, x2: leftX2, y2: cy + halfTextH },
      tx: leftTx,
      ty: cy,
      align: 'right',
    },
    // 2: Above icon
    {
      box: { x1: cx - textW * 0.5 - 3, y1: aboveY1, x2: cx + textW * 0.5 + 3, y2: aboveY2 },
      tx: cx,
      ty: (aboveY1 + aboveY2) * 0.5,
      align: 'center',
    },
    // 3: Below icon
    {
      box: { x1: cx - textW * 0.5 - 3, y1: belowY1, x2: cx + textW * 0.5 + 3, y2: belowY2 },
      tx: cx,
      ty: (belowY1 + belowY2) * 0.5,
      align: 'center',
    },
    // 4: Top-Right diagonal fallback
    {
      box: {
        x1: rightX1,
        y1: cy - diagShiftY - halfTextH,
        x2: rightX2,
        y2: cy - diagShiftY + halfTextH,
      },
      tx: rightTx,
      ty: cy - diagShiftY,
      align: 'left',
    },
    // 5: Bottom-Right diagonal fallback
    {
      box: {
        x1: rightX1,
        y1: cy + diagShiftY - halfTextH,
        x2: rightX2,
        y2: cy + diagShiftY + halfTextH,
      },
      tx: rightTx,
      ty: cy + diagShiftY,
      align: 'left',
    },
    // 6: Top-Left diagonal fallback
    {
      box: {
        x1: leftX1,
        y1: cy - diagShiftY - halfTextH,
        x2: leftX2,
        y2: cy - diagShiftY + halfTextH,
      },
      tx: leftTx,
      ty: cy - diagShiftY,
      align: 'right',
    },
    // 7: Bottom-Left diagonal fallback
    {
      box: {
        x1: leftX1,
        y1: cy + diagShiftY - halfTextH,
        x2: leftX2,
        y2: cy + diagShiftY + halfTextH,
      },
      tx: leftTx,
      ty: cy + diagShiftY,
      align: 'right',
    },
  ];
}

export interface IndexedBuildingWing {
  building: Building3D;
  wing: BuildingWing;
  isPrimary: boolean;
  isLabelHost: boolean;
  hasMultiWings: boolean;
  aabb: WorldAABB;
  area: number;
  maxSpan: number;
  exposedRoofEdges: ExposedWingEdge[];
  exposedWallEdges: ExposedWingEdge[];
  renderSlices: BuildingRenderSlicePlan[];
  labelAnchor: BuildingLabelAnchor;
}

export interface IndexedStreet {
  street: StreetSegment;
  aabb: WorldAABB;
  level: number;
  sortKey: number;
  elevY: number;
  minElevY: number;
  maxElevY: number;
  smoothedPoints: WorldPoint[];
  coarsePoints: WorldPoint[];
  smoothedPoints3D: WorldPoint3D[];
  coarsePoints3D: WorldPoint3D[];
  midIdx: number;
}

export interface IndexedRoute {
  route: MtrRoute;
  aabb: WorldAABB;
  rank: number;
  offsetPts3D: WorldPoint3D[];
  coarsePts3D: WorldPoint3D[];
  cumLens: Float32Array;
  totalLen: number;
  totalDurSec: number;
  avgY: number;
}

export interface LandBorderEdge {
  a: WorldPoint;
  b: WorldPoint;
}

export interface IndexedLand {
  feature: LandFeature;
  aabb: WorldAABB;
  cx: number;
  cz: number;
  exposedBorderEdges: LandBorderEdge[];
  hasSameKindNeighbor: boolean;
}

function decimatePoints<T>(pts: T[], maxPoints: number): T[] {
  if (pts.length <= maxPoints) return pts;
  const step = Math.ceil((pts.length - 1) / (maxPoints - 1));
  const out: T[] = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push(pts[i]);
  }
  if (out[out.length - 1] !== pts[pts.length - 1]) {
    out.push(pts[pts.length - 1]);
  }
  return out;
}

/**
 * Curvature-preserving Douglas-Peucker 3D simplification for transit polylines.
 * Keeps every curve & turn intact (within `tolerance` blocks) instead of decimating to fixed N chords.
 */
function simplifyRoutePoints3D(pts: WorldPoint3D[], tolerance = 2.2): WorldPoint3D[] {
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  const tolSq = tolerance * tolerance;

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start <= 1) continue;
    const a = pts[start];
    const b = pts[end];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;

    let maxDistSq = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const p = pts[i];
      let dSq: number;
      if (lenSq < 1e-6) {
        dSq = (p.x - a.x) * (p.x - a.x) + (p.z - a.z) * (p.z - a.z);
      } else {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
        const px = a.x + t * dx;
        const pz = a.z + t * dz;
        dSq = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
      }
      if (dSq > maxDistSq) {
        maxDistSq = dSq;
        maxIdx = i;
      }
    }

    if (maxIdx !== -1 && maxDistSq > tolSq) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: WorldPoint3D[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) out.push(pts[i]);
  }
  return out;
}

export function buildBuildingSpatialIndex(buildings: Building3D[]): {
  wingIndex: UniformGridIndex<IndexedBuildingWing>;
  buildingIndex: UniformGridIndex<Building3D>;
} {
  const wingIndex = new UniformGridIndex<IndexedBuildingWing>(220);
  const buildingIndex = new UniformGridIndex<Building3D>(220);

  const pendingSlices: Array<{
    entry: IndexedBuildingWing;
    siblingRefs: WingVolumeRef[];
    baseYFallback: number;
  }> = [];

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const wings: BuildingWing[] = getBuildingWings(b);
    const labelAnchor = computeBuildingLabelAnchor(b);
    const baseYFallback = b.baseY ?? SERVER_GROUND_Y;

    // Pick a single valid wing to host the building's centered label/address
    let hostIdx = wings.findIndex((w) => w.id === labelAnchor.wingId && w.footprint && w.footprint.length >= 3);
    if (hostIdx < 0) {
      hostIdx = wings.findIndex((w) => w.footprint && w.footprint.length >= 3);
    }

    const siblingRefs: WingVolumeRef[] = [];

    let bMinX = Infinity;
    let bMaxX = -Infinity;
    let bMinZ = Infinity;
    let bMaxZ = -Infinity;

    for (let wIdx = 0; wIdx < wings.length; wIdx++) {
      const wing = wings[wIdx];
      if (!wing.footprint || wing.footprint.length < 3) continue;
      const tightAabb = computePointsAABB(wing.footprint, 0);
      const wBaseY = wing.baseY ?? baseYFallback;
      siblingRefs.push({
        id: wing.id,
        footprint: wing.footprint,
        baseY: wBaseY,
        roofY: wBaseY + Math.max(0, wing.height),
        aabb: tightAabb,
      });
    }

    for (let wIdx = 0; wIdx < wings.length; wIdx++) {
      const wing = wings[wIdx];
      if (!wing.footprint || wing.footprint.length < 3) continue;
      const aabb = computePointsAABB(wing.footprint, 2);
      if (aabb.minX < bMinX) bMinX = aabb.minX;
      if (aabb.maxX > bMaxX) bMaxX = aabb.maxX;
      if (aabb.minZ < bMinZ) bMinZ = aabb.minZ;
      if (aabb.maxZ > bMaxZ) bMaxZ = aabb.maxZ;

      const spanX = aabb.maxX - aabb.minX;
      const spanZ = aabb.maxZ - aabb.minZ;
      const area = (wing.measuredWidth ?? spanX) * (wing.measuredDepth ?? spanZ);
      const { exposedRoofEdges, exposedWallEdges } = computeWingExposedEdges(
        wing,
        wings,
        baseYFallback
      );

      const entry: IndexedBuildingWing = {
        building: b,
        wing,
        isPrimary: wIdx === 0,
        isLabelHost: wIdx === hostIdx,
        hasMultiWings: wings.length > 1,
        aabb,
        area,
        maxSpan: Math.max(spanX, spanZ),
        exposedRoofEdges,
        exposedWallEdges,
        renderSlices: [],
        labelAnchor,
      };
      wingIndex.insert(entry, aabb);
      pendingSlices.push({ entry, siblingRefs, baseYFallback });
    }

    if (Number.isFinite(bMinX)) {
      buildingIndex.insert(b, { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ });
    }
  }

  // Second pass: precompute vertically clipped wall slices & elevation bands per wing
  const neighborBuf: IndexedBuildingWing[] = [];
  for (let i = 0; i < pendingSlices.length; i++) {
    const { entry, siblingRefs, baseYFallback } = pendingSlices[i];
    const neighbors = wingIndex.queryAABB(entry.aabb, neighborBuf);
    const externalRefs: WingVolumeRef[] = [];
    for (let j = 0; j < neighbors.length; j++) {
      const nb = neighbors[j];
      if (nb.building.id === entry.building.id || nb.wing.footprint.length < 3) continue;
      const nbBaseY = nb.wing.baseY ?? nb.building.baseY ?? SERVER_GROUND_Y;
      externalRefs.push({
        id: nb.wing.id,
        footprint: nb.wing.footprint,
        baseY: nbBaseY,
        roofY: nbBaseY + Math.max(0, nb.wing.height),
        aabb: computePointsAABB(nb.wing.footprint, 0),
      });
    }
    entry.renderSlices = computeWingRenderSlices(
      entry.wing,
      siblingRefs,
      externalRefs,
      baseYFallback
    );
  }

  return { wingIndex, buildingIndex };
}

export function buildStreetSpatialIndex(streets: StreetSegment[]): UniformGridIndex<IndexedStreet> {
  const index = new UniformGridIndex<IndexedStreet>(320);

  const sampleElevAt = (pt: WorldPoint, source3D: WorldPoint3D[], fallbackY: number): number => {
    if (source3D.length < 2) return source3D[0]?.y ?? fallbackY;
    let bestDistSq = Infinity;
    let bestY = fallbackY;
    for (let j = 0; j < source3D.length - 1; j++) {
      const a = source3D[j];
      const b = source3D[j + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq > 1e-4 ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / lenSq)) : 0;
      const px = a.x + t * dx;
      const pz = a.z + t * dz;
      const dSq = (pt.x - px) * (pt.x - px) + (pt.z - pz) * (pt.z - pz);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestY = a.y + t * (b.y - a.y);
      }
    }
    return bestY;
  };

  for (let i = 0; i < streets.length; i++) {
    const street = streets[i];
    if (street.points.length < 2) continue;

    const level = getRoadHierarchyLevel(street.roadClass);
    const hasPoints3D = Boolean(street.points3D && street.points3D.length === street.points.length);
    const raw3D: WorldPoint3D[] = hasPoints3D
      ? street.points3D!
      : street.points.map((p) => ({ x: p.x, y: street.elevationY ?? SERVER_GROUND_Y, z: p.z }));

    let minElevY = Infinity;
    let maxElevY = -Infinity;
    let sumY = 0;
    for (let k = 0; k < raw3D.length; k++) {
      const y = raw3D[k].y;
      if (y < minElevY) minElevY = y;
      if (y > maxElevY) maxElevY = y;
      sumY += y;
    }
    const elevY = Number.isFinite(sumY) && raw3D.length > 0 ? sumY / raw3D.length : street.elevationY ?? SERVER_GROUND_Y;
    const elevBand = Math.round((elevY - SERVER_GROUND_Y) / 4);
    const sortKey = (elevBand + 20) * 10 + level;

    const filletRadius =
      street.roadClass === 'highway'
        ? 28
        : street.roadClass === 'avenue' || street.roadClass === 'railway'
        ? 20
        : street.roadClass === 'embankment'
        ? 16
        : 11;

    // Precompute smoothed geometry ONCE instead of per frame!
    const smoothedPoints = smoothStreetPolyline(street.points, filletRadius, 3);
    const coarsePoints = decimatePoints(street.points, 20);
    const smoothedPoints3D: WorldPoint3D[] = hasPoints3D
      ? smoothedPoints.map((p) => ({ x: p.x, y: sampleElevAt(p, raw3D, elevY), z: p.z }))
      : smoothedPoints.map((p) => ({ x: p.x, y: elevY, z: p.z }));
    const coarsePoints3D: WorldPoint3D[] = hasPoints3D
      ? decimatePoints(raw3D, 20)
      : coarsePoints.map((p) => ({ x: p.x, y: elevY, z: p.z }));

    const aabb = computePointsAABB(smoothedPoints, street.width * 0.6 + 6);

    index.insert(
      {
        street,
        aabb,
        level,
        sortKey,
        elevY,
        minElevY: Number.isFinite(minElevY) ? minElevY : elevY,
        maxElevY: Number.isFinite(maxElevY) ? maxElevY : elevY,
        smoothedPoints,
        coarsePoints,
        smoothedPoints3D,
        coarsePoints3D,
        midIdx: Math.floor((street.points.length - 1) / 2),
      },
      aabb
    );
  }

  return index;
}

export function buildRouteSpatialIndex(routes: MtrRoute[]): {
  sortedRoutes: IndexedRoute[];
  routeIndex: UniformGridIndex<IndexedRoute>;
} {
  const rank = (k: MtrRoute['kind']) =>
    k === 'metro'
      ? 1
      : k === 'rail'
      ? 2
      : k === 'cable'
      ? 5
      : k === 'plane'
      ? 6
      : k === 'tram'
      ? 4
      : 3;

  const list: IndexedRoute[] = [];
  const routeIndex = new UniformGridIndex<IndexedRoute>(512);

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (route.stops.length < 2) continue;

    const pts3D: WorldPoint3D[] =
      route.tracedPath3D && route.tracedPath3D.length >= 2
        ? route.tracedPath3D
        : route.tracedPath && route.tracedPath.length >= 2
        ? route.tracedPath.map((p) => ({
            x: p.x,
            y: route.stops[0]?.y ?? SERVER_GROUND_Y,
            z: p.z,
          }))
        : route.stops.map((s) => ({ x: s.x, y: s.y, z: s.z }));

    const laneOff = route.corridorOffset ?? 0;
    let sumY = 0;
    const offsetPts3D: WorldPoint3D[] = new Array(pts3D.length);
    for (let j = 0; j < pts3D.length; j++) {
      const pt = pts3D[j];
      sumY += pt.y;
      let ox = pt.x;
      let oz = pt.z;
      if (laneOff !== 0 && pts3D.length >= 2) {
        const prevPt = pts3D[j > 0 ? j - 1 : 0];
        const nextPt = pts3D[j < pts3D.length - 1 ? j + 1 : pts3D.length - 1];
        const dx = nextPt.x - prevPt.x;
        const dz = nextPt.z - prevPt.z;
        const len = Math.hypot(dx, dz) || 1;
        ox += (-dz / len) * laneOff;
        oz += (dx / len) * laneOff;
      }
      offsetPts3D[j] = { x: ox, y: pt.y, z: oz };
    }

    const cumLens = new Float32Array(offsetPts3D.length);
    let totalLen = 0;
    for (let j = 1; j < offsetPts3D.length; j++) {
      totalLen += Math.hypot(
        offsetPts3D[j].x - offsetPts3D[j - 1].x,
        offsetPts3D[j].z - offsetPts3D[j - 1].z
      );
      cumLens[j] = totalLen;
    }

    const totalDurSec =
      route.segmentDurationsMs.reduce((a, b) => a + b, 0) / 1000 || 120;
    const aabb = computePointsAABB(offsetPts3D, 24);
    const coarsePts3D = simplifyRoutePoints3D(offsetPts3D, 2.2);

    const indexed: IndexedRoute = {
      route,
      aabb,
      rank: rank(route.kind),
      offsetPts3D,
      coarsePts3D,
      cumLens,
      totalLen,
      totalDurSec,
      avgY: sumY / pts3D.length,
    };
    list.push(indexed);
    routeIndex.insert(indexed, aabb);
  }

  list.sort((a, b) => a.rank - b.rank);
  return { sortedRoutes: list, routeIndex };
}

export function buildStationSpatialIndex(stations: MtrStation[]): {
  prioritizedStations: MtrStation[];
  stationIndex: UniformGridIndex<MtrStation>;
} {
  const prioritizedStations = [...stations].sort((a, b) => {
    const aMetro = a.kinds.includes('metro') ? 1 : 0;
    const bMetro = b.kinds.includes('metro') ? 1 : 0;
    if (aMetro !== bMetro) return bMetro - aMetro;
    return b.routeIds.length - a.routeIds.length;
  });

  const stationIndex = new UniformGridIndex<MtrStation>(256);
  for (let i = 0; i < prioritizedStations.length; i++) {
    const s = prioritizedStations[i];
    stationIndex.insert(s, {
      minX: s.x - 16,
      maxX: s.x + 16,
      minZ: s.z - 16,
      maxZ: s.z + 16,
    });
  }

  return { prioritizedStations, stationIndex };
}

/**
 * Computes only the exterior boundary segments of a territory polygon, hiding
 * shared or overlapping internal edges against neighboring territories of the SAME
 * `kind` (`water`+`water`, `park`+`park`, `square`+`square`) so adjacent territories
 * join seamlessly while preserving crisp borders between different types.
 */
export function computeLandExposedEdges(
  feature: LandFeature,
  sameKindNeighborPolys: WorldPoint[][],
  eps = 0.45
): LandBorderEdge[] {
  if (feature.polygon.length < 3) return [];
  const exposed = clipFootprintEdgesAgainstOccluders(feature.polygon, sameKindNeighborPolys, eps);
  return exposed.map((e) => ({ a: e.a, b: e.b }));
}

export function buildLandSpatialIndex(features: LandFeature[]): UniformGridIndex<IndexedLand> {
  const index = new UniformGridIndex<IndexedLand>(384);
  const valid: Array<{ feature: LandFeature; aabb: WorldAABB; cx: number; cz: number }> = [];

  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    if (feat.polygon.length < 3) continue;
    let cx = 0;
    let cz = 0;
    for (let j = 0; j < feat.polygon.length; j++) {
      cx += feat.polygon[j].x;
      cz += feat.polygon[j].z;
    }
    cx /= feat.polygon.length;
    cz /= feat.polygon.length;
    const aabb = computePointsAABB(feat.polygon, 4);
    valid.push({ feature: feat, aabb, cx, cz });
  }

  for (let i = 0; i < valid.length; i++) {
    const item = valid[i];
    const sameKindNeighbors: WorldPoint[][] = [];
    for (let j = 0; j < valid.length; j++) {
      if (i === j) continue;
      const other = valid[j];
      if (other.feature.kind !== item.feature.kind) continue;
      if (!aabbIntersects(item.aabb, other.aabb)) continue;
      sameKindNeighbors.push(other.feature.polygon);
    }

    const exposedBorderEdges = computeLandExposedEdges(item.feature, sameKindNeighbors, 0.45);
    index.insert(
      {
        feature: item.feature,
        aabb: item.aabb,
        cx: item.cx,
        cz: item.cz,
        exposedBorderEdges,
        hasSameKindNeighbor: sameKindNeighbors.length > 0,
      },
      item.aabb
    );
  }
  return index;
}

/**
 * Binary search along precomputed cumulative segment lengths for O(log N) live vehicle positioning.
 */
export function samplePointAlongRoute3D(
  indexed: IndexedRoute,
  targetDist: number
): { x: number; y: number; z: number; segIdx: number } {
  const pts = indexed.offsetPts3D;
  const cum = indexed.cumLens;
  const n = pts.length;
  if (n < 2) {
    const p = pts[0] ?? { x: 0, y: SERVER_GROUND_Y, z: 0 };
    return { x: p.x, y: p.y, z: p.z, segIdx: 0 };
  }

  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid + 1] < targetDist) lo = mid + 1;
    else hi = mid;
  }

  const segStart = cum[lo];
  const segLen = cum[lo + 1] - segStart;
  const frac = segLen > 1e-4 ? Math.max(0, Math.min(1, (targetDist - segStart) / segLen)) : 0;
  const a = pts[lo];
  const b = pts[lo + 1];
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
    z: a.z + (b.z - a.z) * frac,
    segIdx: lo,
  };
}

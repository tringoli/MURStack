import type { MtrRoute, WorldPoint, WorldPoint3D } from '../types/map';
import {
  buildTurnaroundConnector3D,
  removePathVortices3D,
  SERVER_GROUND_Y,
  smoothMagic3DPath,
} from './geometry';

/**
 * Raw MAGIC API (MTR Addon for General Improvement and Customisation / JME)
 * rail segment schema served by `http://map.murs-mc.ru:8088/api/rails?dimension=0`.
 */
export interface MagicRailPointRaw {
  x: number;
  y?: number;
  z: number;
}

export interface MagicConnectedNodeRaw {
  routes?: Array<string | number>;
}

export interface MagicRailSegment {
  id?: string;
  curvePoints?: MagicRailPointRaw[];
  position1?: MagicRailPointRaw;
  position2?: MagicRailPointRaw;
  /** Optional MTR 4 / MAGIC rail end tangents (degrees or radians) for exact curve reconstruction */
  angle1?: number;
  angle2?: number;
  facing1?: number;
  facing2?: number;
  connectedNodes?: MagicConnectedNodeRaw[];
  routes?: Array<string | number>;
  speedLimit1?: number;
  speedLimit2?: number;
}

export interface MagicVehicleLive {
  id?: string;
  routeId?: string;
  x: number;
  y: number;
  z: number;
  angle?: number;
  speedKmh?: number;
}

export interface MagicTraceResult {
  routes: MtrRoute[];
  railsLoaded: number;
  routesTracedFromMagicRails: number;
  routesSmoothedFromMagic3D: number;
  totalRoutes: number;
  liveVehiclesCount: number;
}

export function normalizeMagicId(value: string | number | null | undefined): string {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw.slice(2) : raw;
}

function angleToUnitVec2D(rawAngle: number): { dx: number; dz: number } {
  // Handle both radians (|a| <= 2*PI + 0.05) and degrees
  const rad = Math.abs(rawAngle) > Math.PI * 2 + 0.05 ? (rawAngle * Math.PI) / 180 : rawAngle;
  return { dx: Math.cos(rad), dz: Math.sin(rad) };
}

export function extractMagicRailPoints3D(rail: MagicRailSegment): WorldPoint3D[] {
  const pts: WorldPoint3D[] = [];
  const p1 = rail.position1;
  const p2 = rail.position2;
  const y1Raw = Number(p1?.y);
  const y2Raw = Number(p2?.y);
  const hasEndY1 = Number.isFinite(y1Raw);
  const hasEndY2 = Number.isFinite(y2Raw);
  const fallbackY1 = hasEndY1 ? y1Raw : hasEndY2 ? y2Raw : SERVER_GROUND_Y;
  const fallbackY2 = hasEndY2 ? y2Raw : hasEndY1 ? y1Raw : SERVER_GROUND_Y;

  if (Array.isArray(rail.curvePoints) && rail.curvePoints.length >= 2) {
    const total = rail.curvePoints.length;
    for (let idx = 0; idx < total; idx++) {
      const pt = rail.curvePoints[idx];
      const x = Number(pt?.x);
      const z = Number(pt?.z);
      const rawY = pt?.y !== undefined && pt?.y !== null ? Number(pt.y) : NaN;
      // MAGIC `/api/rails` curvePoints frequently omit `y` — interpolate from position1.y -> position2.y
      // so underground metro & elevated viaduct curves stay at their true Y and stitch cleanly!
      const u = total > 1 ? idx / (total - 1) : 0;
      const y = Number.isFinite(rawY) ? rawY : fallbackY1 + (fallbackY2 - fallbackY1) * u;
      if (Number.isFinite(x) && Number.isFinite(z)) {
        const prev = pts[pts.length - 1];
        if (!prev || Math.hypot(x - prev.x, z - prev.z) >= 0.25 || Math.abs(y - prev.y) >= 0.25) {
          pts.push({ x, y, z });
        }
      }
    }
    // Always preserve exact last curvePoint for zero-gap endpoint stitching
    const lastRaw = rail.curvePoints[total - 1];
    const lx = Number(lastRaw?.x);
    const lz = Number(lastRaw?.z);
    if (Number.isFinite(lx) && Number.isFinite(lz) && pts.length >= 1) {
      const ly =
        lastRaw?.y !== undefined && lastRaw?.y !== null && Number.isFinite(Number(lastRaw.y))
          ? Number(lastRaw.y)
          : fallbackY2;
      const prev = pts[pts.length - 1];
      if (Math.hypot(lx - prev.x, lz - prev.z) > 0.05) {
        pts.push({ x: lx, y: ly, z: lz });
      }
    }
  }
  if (pts.length >= 2) return pts;

  const x1 = Number(p1?.x);
  const z1 = Number(p1?.z);
  const x2 = Number(p2?.x);
  const z2 = Number(p2?.z);
  if (
    Number.isFinite(x1) &&
    Number.isFinite(z1) &&
    Number.isFinite(x2) &&
    Number.isFinite(z2)
  ) {
    const y1 = Number.isFinite(Number(p1?.y)) ? Number(p1?.y) : SERVER_GROUND_Y;
    const y2 = Number.isFinite(Number(p2?.y)) ? Number(p2?.y) : SERVER_GROUND_Y;
    const dist = Math.hypot(x2 - x1, z2 - z1);

    // If MAGIC provides end headings (angle1/angle2 or facing1/facing2), reconstruct block-exact cubic Bezier!
    const rawA1 = Number.isFinite(Number(rail.angle1))
      ? Number(rail.angle1)
      : Number.isFinite(Number(rail.facing1))
      ? Number(rail.facing1)
      : NaN;
    const rawA2 = Number.isFinite(Number(rail.angle2))
      ? Number(rail.angle2)
      : Number.isFinite(Number(rail.facing2))
      ? Number(rail.facing2)
      : NaN;

    if (dist >= 3 && Number.isFinite(rawA1) && Number.isFinite(rawA2)) {
      const t1 = angleToUnitVec2D(rawA1);
      const t2 = angleToUnitVec2D(rawA2);
      // Orient tangents toward the opposite endpoint
      const chordX = (x2 - x1) / dist;
      const chordZ = (z2 - z1) / dist;
      const s1 = t1.dx * chordX + t1.dz * chordZ >= 0 ? 1 : -1;
      const s2 = t2.dx * -chordX + t2.dz * -chordZ >= 0 ? 1 : -1;
      const handle = dist * 0.35;
      const c1x = x1 + t1.dx * s1 * handle;
      const c1z = z1 + t1.dz * s1 * handle;
      const c2x = x2 + t2.dx * s2 * handle;
      const c2z = z2 + t2.dz * s2 * handle;

      const steps = Math.max(4, Math.min(48, Math.ceil(dist / 2)));
      const sampled: WorldPoint3D[] = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const omu = 1 - u;
        const bx = omu * omu * omu * x1 + 3 * omu * omu * u * c1x + 3 * omu * u * u * c2x + u * u * u * x2;
        const bz = omu * omu * omu * z1 + 3 * omu * omu * u * c1z + 3 * omu * u * u * c2z + u * u * u * z2;
        const by = y1 + (y2 - y1) * u;
        sampled.push({
          x: Math.round(bx * 10) / 10,
          y: Math.round(by * 10) / 10,
          z: Math.round(bz * 10) / 10,
        });
      }
      return sampled;
    }

    return [
      { x: x1, y: y1, z: z1 },
      { x: x2, y: y2, z: z2 },
    ];
  }

  return pts;
}

/**
 * Light deviation-bounded smoothing for block-for-block MAGIC rail traces:
 * rounds 1-block Minecraft voxel staircases into silky continuous curves while
 * guaranteeing every smoothed point stays within `maxDeviation` (~0.45 blocks) of the real rail!
 */
export function smoothMagicBlockExact3D(
  points: WorldPoint3D[],
  maxDeviation = 0.45
): WorldPoint3D[] {
  if (points.length <= 2) return points;
  // Pass 1: Subtle Chaikin corner-polishing only on dense short steps, clamped to maxDeviation
  const current = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const refined: WorldPoint3D[] = [current[0]];

  for (let i = 1; i < current.length - 1; i++) {
    const prev = current[i - 1];
    const curr = current[i];
    const next = current[i + 1];

    // Weighted midpoint (0.22 prev + 0.56 curr + 0.22 next) preserves exact curve radius
    const sx = prev.x * 0.22 + curr.x * 0.56 + next.x * 0.22;
    const sy = prev.y * 0.22 + curr.y * 0.56 + next.y * 0.22;
    const sz = prev.z * 0.22 + curr.z * 0.56 + next.z * 0.22;

    const dx = sx - curr.x;
    const dz = sz - curr.z;
    const shift = Math.hypot(dx, dz);
    const clampScale = shift > maxDeviation && shift > 1e-4 ? maxDeviation / shift : 1;

    const nx = Math.round((curr.x + dx * clampScale) * 10) / 10;
    const ny = Math.round(sy * 10) / 10;
    const nz = Math.round((curr.z + dz * clampScale) * 10) / 10;
    const last = refined[refined.length - 1];
    if (Math.hypot(nx - last.x, nz - last.z) >= 0.65 || Math.abs(ny - last.y) >= 0.4) {
      refined.push({ x: nx, y: ny, z: nz });
    }
  }
  refined.push(current[current.length - 1]);

  // Pass 2: For any long straight gap (> 16 blocks), add gentle Catmull-Rom curve continuity
  if (refined.length <= 3) return refined;
  const out: WorldPoint3D[] = [refined[0]];
  for (let i = 0; i < refined.length - 1; i++) {
    const p1 = refined[i];
    const p2 = refined[i + 1];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    if (segLen > 14 && i > 0 && i + 2 < refined.length) {
      const p0 = refined[i - 1];
      const p3 = refined[i + 2];
      const steps = Math.min(4, Math.ceil(segLen / 10));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const cx =
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const cz =
          0.5 *
          (2 * p1.z +
            (-p0.z + p2.z) * t +
            (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
            (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
        const cy = p1.y + (p2.y - p1.y) * t;
        out.push({
          x: Math.round(cx * 10) / 10,
          y: Math.round(cy * 10) / 10,
          z: Math.round(cz * 10) / 10,
        });
      }
    }
    out.push(p2);
  }
  return out;
}

function pushNormalizedRouteIds(target: Set<string>, rawList: unknown): void {
  if (!Array.isArray(rawList)) return;
  for (const item of rawList) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const nested = rec.id ?? rec.routeId ?? rec.hexId;
      const norm = normalizeMagicId(nested as string | number | undefined);
      if (norm) target.add(norm);
    } else {
      const norm = normalizeMagicId(item as string | number | undefined);
      if (norm) target.add(norm);
    }
  }
}

export function getRouteIdsForMagicRail(rail: MagicRailSegment): string[] {
  const out = new Set<string>();
  const rec = rail as unknown as Record<string, unknown>;
  pushNormalizedRouteIds(out, rail.routes);
  pushNormalizedRouteIds(out, rec.routeIds);
  const nodes = Array.isArray(rail.connectedNodes) ? rail.connectedNodes : [];
  for (const node of nodes) {
    pushNormalizedRouteIds(out, node?.routes);
    pushNormalizedRouteIds(out, (node as unknown as Record<string, unknown>)?.routeIds);
  }
  return Array.from(out);
}

/**
 * Parses a raw MAGIC API `/api/rails` JSON payload (either wrapped in `{ data: ... }` or direct).
 */
export function parseMagicRailsPayload(raw: unknown): {
  rails: MagicRailSegment[];
  vehicles: MagicVehicleLive[];
} {
  if (!raw || typeof raw !== 'object') {
    return { rails: [], vehicles: [] };
  }
  const obj = raw as Record<string, unknown>;
  const inner =
    obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : obj;

  const rawRails = Array.isArray(inner.rails)
    ? inner.rails
    : Array.isArray(inner.tracks)
    ? inner.tracks
    : [];

  const rails: MagicRailSegment[] = [];
  for (const r of rawRails) {
    if (!r || typeof r !== 'object') continue;
    const seg = r as MagicRailSegment;
    if (extractMagicRailPoints3D(seg).length >= 2) {
      rails.push(seg);
    }
  }

  const rawVehicles = Array.isArray(inner.vehicles) ? inner.vehicles : [];
  const vehicles: MagicVehicleLive[] = [];
  for (const v of rawVehicles) {
    if (!v || typeof v !== 'object') continue;
    const rec = v as Record<string, unknown>;
    const x = Number(rec.x ?? (rec.position as Record<string, unknown> | undefined)?.x);
    const z = Number(rec.z ?? (rec.position as Record<string, unknown> | undefined)?.z);
    const y = Number(rec.y ?? (rec.position as Record<string, unknown> | undefined)?.y ?? SERVER_GROUND_Y);
    if (Number.isFinite(x) && Number.isFinite(z)) {
      vehicles.push({
        id: rec.id !== undefined ? String(rec.id) : undefined,
        routeId: rec.routeId !== undefined ? normalizeMagicId(String(rec.routeId)) : undefined,
        x,
        y: Number.isFinite(y) ? y : SERVER_GROUND_Y,
        z,
        angle: Number.isFinite(Number(rec.angle)) ? Number(rec.angle) : undefined,
        speedKmh: Number.isFinite(Number(rec.speedKmh ?? rec.speed))
          ? Number(rec.speedKmh ?? rec.speed)
          : undefined,
      });
    }
  }

  return { rails, vehicles };
}

interface RailEdge {
  to: number;
  length: number;
  points3D: WorldPoint3D[];
  routeIds: Set<string>;
  startDirX: number;
  startDirZ: number;
  endDirX: number;
  endDirZ: number;
}

interface RailNode {
  id: number;
  x: number;
  y: number;
  z: number;
  edges: RailEdge[];
}

/**
 * Traces public transport lines directly from MAGIC API 3D rail segments (`curvePoints` + `connectedNodes`).
 *
 * Strategy per consecutive station pair `stops[i] -> stops[i+1]`:
 * 1. Build a 3D spatial rail graph from all MAGIC rail segments, preserving each rail's exact `curvePoints` (X/Y/Z)
 *    and its tagged `connectedNodes[].routes` route IDs.
 * 2. Run A* preferring rails explicitly tagged with `normalizeMagicId(route.id)` (0.25x cost preference vs untagged rails)
 *    so the traced line follows the exact physical tracks & curves reported by MAGIC API.
 * 3. Stitch exact 3D rail curves across all stops and apply gentle Catmull-Rom 3D smoothing where stations connect.
 * 4. If no MAGIC rails exist for a route (e.g. port 8088 unavailable or unmapped segment), preserve the exact
 *    MAGIC/JME 3D station platform coordinates `(x, y, z)` smoothed with `smoothMagic3DPath`.
 */
export function traceRoutesFromMagicRails(
  routes: MtrRoute[],
  rails: MagicRailSegment[],
  liveVehiclesCount = 0
): MagicTraceResult {
  if (rails.length === 0) {
    // Fallback when port 8088 rail curves are unreachable: use real MTR/JME 3D station coordinates
    const smoothedRoutes = routes.map((route) => {
      if (route.stops.length < 2) return route;
      const raw3D: WorldPoint3D[] = route.stops.map((s) => ({
        x: s.x,
        y: Number.isFinite(s.y) ? s.y : SERVER_GROUND_Y,
        z: s.z,
      }));
      const smoothed3D = smoothMagic3DPath(raw3D, 3);
      return {
        ...route,
        tracedPath: smoothed3D.map((p): WorldPoint => ({ x: p.x, z: p.z })),
        tracedPath3D: smoothed3D,
        magicSmoothed: true,
        magicTraced: false,
      };
    });

    const connectedRoutes = connectBidirectionalRouteTermini(smoothedRoutes);

    return {
      routes: connectedRoutes,
      railsLoaded: 0,
      routesTracedFromMagicRails: 0,
      routesSmoothedFromMagic3D: connectedRoutes.length,
      totalRoutes: routes.length,
      liveVehiclesCount,
    };
  }

  // Build spatial hash for rail endpoint merging (tolerance 3 blocks in X/Z, 4 blocks in Y)
  const nodes: RailNode[] = [];
  const CELL = 16;
  const spatial = new Map<string, number[]>();

  const cellKey = (cx: number, cz: number) => `${cx}_${cz}`;
  const addSpatial = (id: number, x: number, z: number) => {
    const k = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
    const bucket = spatial.get(k);
    if (bucket) bucket.push(id);
    else spatial.set(k, [id]);
  };

  const nearbyNodes = (x: number, z: number, radius: number): number[] => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const span = Math.ceil(radius / CELL);
    const out: number[] = [];
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const b = spatial.get(cellKey(cx + dx, cz + dz));
        if (b) {
          for (let i = 0; i < b.length; i++) out.push(b[i]);
        }
      }
    }
    return out;
  };

  const railHasExplicitY = (rail: MagicRailSegment): boolean => {
    if (rail.position1?.y !== undefined && Number.isFinite(Number(rail.position1.y))) return true;
    if (rail.position2?.y !== undefined && Number.isFinite(Number(rail.position2.y))) return true;
    if (
      Array.isArray(rail.curvePoints) &&
      rail.curvePoints.some((p) => p?.y !== undefined && Number.isFinite(Number(p.y)))
    ) {
      return true;
    }
    return false;
  };

  const nodeHasExplicitY: boolean[] = [];

  const findOrCreateNode = (pt: WorldPoint3D, explicitY: boolean): number => {
    const cands = nearbyNodes(pt.x, pt.z, 2.8);
    let bestId = -1;
    let bestDist = 2.25;
    for (const id of cands) {
      const n = nodes[id];
      const d = Math.hypot(n.x - pt.x, n.z - pt.z);
      // Only enforce Y-level separation when BOTH rails carry explicit Y coordinates;
      // otherwise MAGIC curvePoints without `y` fail to stitch to position1/2 rails!
      const yOk =
        !explicitY || !nodeHasExplicitY[id] || Math.abs(n.y - pt.y) <= 5.0;
      if (d <= bestDist && yOk) {
        bestDist = d;
        bestId = id;
      }
    }
    if (bestId !== -1) {
      if (explicitY && !nodeHasExplicitY[bestId]) {
        nodes[bestId].y = pt.y;
        nodeHasExplicitY[bestId] = true;
      }
      return bestId;
    }
    const id = nodes.length;
    nodes.push({ id, x: pt.x, y: pt.y, z: pt.z, edges: [] });
    nodeHasExplicitY.push(explicitY);
    addSpatial(id, pt.x, pt.z);
    return id;
  };

  const computeEdgeDirections = (pts: WorldPoint3D[]) => {
    const first = pts[0];
    let second = pts[1];
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - first.x, pts[i].z - first.z) >= 1.2) {
        second = pts[i];
        break;
      }
    }
    const last = pts[pts.length - 1];
    let prev = pts[pts.length - 2];
    for (let i = pts.length - 2; i >= 0; i--) {
      if (Math.hypot(last.x - pts[i].x, last.z - pts[i].z) >= 1.2) {
        prev = pts[i];
        break;
      }
    }
    const sLen = Math.hypot(second.x - first.x, second.z - first.z) || 1;
    const eLen = Math.hypot(last.x - prev.x, last.z - prev.z) || 1;
    return {
      startDirX: (second.x - first.x) / sLen,
      startDirZ: (second.z - first.z) / sLen,
      endDirX: (last.x - prev.x) / eLen,
      endDirZ: (last.z - prev.z) / eLen,
    };
  };

  // Track which nodes belong to each route for ultra-fast start/end snapping
  const routeNodeSet = new Map<string, Set<number>>();

  for (const rail of rails) {
    const pts = extractMagicRailPoints3D(rail);
    if (pts.length < 2) continue;
    const hasY = railHasExplicitY(rail);
    const startId = findOrCreateNode(pts[0], hasY);
    const endId = findOrCreateNode(pts[pts.length - 1], hasY);
    if (startId === endId) continue;

    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      length += Math.hypot(
        pts[i].x - pts[i - 1].x,
        pts[i].z - pts[i - 1].z,
        (pts[i].y - pts[i - 1].y) * 0.5
      );
    }
    const routeIds = new Set(getRouteIdsForMagicRail(rail));
    for (const rId of routeIds) {
      let s = routeNodeSet.get(rId);
      if (!s) {
        s = new Set<number>();
        routeNodeSet.set(rId, s);
      }
      s.add(startId);
      s.add(endId);
    }

    const fwdDirs = computeEdgeDirections(pts);
    const revPts = [...pts].reverse();
    const revDirs = computeEdgeDirections(revPts);

    nodes[startId].edges.push({ to: endId, length, points3D: pts, routeIds, ...fwdDirs });
    nodes[endId].edges.push({
      to: startId,
      length,
      points3D: revPts,
      routeIds,
      ...revDirs,
    });
  }

  const findClosestRailNode = (
    x: number,
    y: number,
    z: number,
    normRouteId: string,
    maxRadius = 140
  ): number | null => {
    const preferredSet = routeNodeSet.get(normRouteId);
    const cands = nearbyNodes(x, z, maxRadius);
    let bestPref: number | null = null;
    let bestPrefScore = maxRadius;
    let bestAny: number | null = null;
    let bestAnyScore = maxRadius;

    for (const id of cands) {
      const n = nodes[id];
      const yPenalty = nodeHasExplicitY[id] ? Math.abs(n.y - y) * 0.25 : 0;
      const d = Math.hypot(n.x - x, n.z - z) + yPenalty;
      if (d < bestAnyScore) {
        bestAnyScore = d;
        bestAny = id;
      }
      if (preferredSet?.has(id) && d < bestPrefScore) {
        bestPrefScore = d;
        bestPref = id;
      }
    }
    return bestPref ?? bestAny;
  };

  const traceRailSegmentAStar = (
    startId: number,
    goalId: number,
    normRouteId: string,
    maxDistBudget: number,
    routeTaggedOnly = false
  ): { pts3D: WorldPoint3D[]; edgeCount: number } | null => {
    if (startId === goalId) {
      const n = nodes[startId];
      return { pts3D: [{ x: n.x, y: n.y, z: n.z }], edgeCount: 0 };
    }

    const goal = nodes[goalId];
    const gScore = new Map<number, number>();
    const prev = new Map<number, { fromId: number; edge: RailEdge }>();
    const closed = new Set<number>();

    const hScale = routeTaggedOnly ? 0.5 : 0.08;
    const heap: Array<{ id: number; f: number }> = [
      { id: startId, f: Math.hypot(goal.x - nodes[startId].x, goal.z - nodes[startId].z) * hScale },
    ];
    gScore.set(startId, 0);

    const pushHeap = (item: { id: number; f: number }) => {
      heap.push(item);
      let idx = heap.length - 1;
      while (idx > 0) {
        const p = (idx - 1) >> 1;
        if (heap[p].f <= heap[idx].f) break;
        [heap[p], heap[idx]] = [heap[idx], heap[p]];
        idx = p;
      }
    };

    const popHeap = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let idx = 0;
        while (true) {
          let sm = idx;
          const l = 2 * idx + 1;
          const r = 2 * idx + 2;
          if (l < heap.length && heap[l].f < heap[sm].f) sm = l;
          if (r < heap.length && heap[r].f < heap[sm].f) sm = r;
          if (sm === idx) break;
          [heap[idx], heap[sm]] = [heap[sm], heap[idx]];
          idx = sm;
        }
      }
      return top;
    };

    let iters = 0;
    const maxIters = routeTaggedOnly ? 16000 : 24000;
    while (heap.length > 0 && iters < maxIters) {
      iters++;
      const cur = popHeap();
      if (cur.id === goalId) break;
      if (closed.has(cur.id)) continue;
      closed.add(cur.id);

      const curG = gScore.get(cur.id) ?? Infinity;
      if (curG > maxDistBudget) continue;

      const prevStep = prev.get(cur.id);
      const node = nodes[cur.id];
      for (const edge of node.edges) {
        if (closed.has(edge.to)) continue;
        const matchesRoute = edge.routeIds.has(normRouteId);
        if (routeTaggedOnly && !matchesRoute) continue;

        // Strongly lock onto rails explicitly tagged with this routeId from MAGIC connectedNodes
        let weight = routeTaggedOnly
          ? 1.0
          : matchesRoute
          ? 0.08
          : edge.routeIds.size === 0
          ? 1.0
          : 5.5;

        // Enforce rail switch heading continuity (trains cannot execute sharp reverse switches mid-track!)
        let turnPenalty = 0;
        if (prevStep) {
          const dot =
            prevStep.edge.endDirX * edge.startDirX + prevStep.edge.endDirZ * edge.startDirZ;
          if (dot < -0.35) {
            turnPenalty = 240;
            weight *= 2.5;
          } else if (dot < 0.25) {
            turnPenalty = 24;
          }
        }

        const nextG = curG + edge.length * weight + turnPenalty;
        if (nextG < (gScore.get(edge.to) ?? Infinity)) {
          gScore.set(edge.to, nextG);
          prev.set(edge.to, { fromId: cur.id, edge });
          const h = Math.hypot(goal.x - nodes[edge.to].x, goal.z - nodes[edge.to].z) * hScale;
          pushHeap({ id: edge.to, f: nextG + h });
        }
      }
    }

    if (!prev.has(goalId)) return null;

    const chainEdges: RailEdge[] = [];
    let cur: number | undefined = goalId;
    while (cur !== undefined && cur !== startId) {
      const step = prev.get(cur);
      if (!step) break;
      chainEdges.push(step.edge);
      cur = step.fromId;
    }
    chainEdges.reverse();

    const pts3D: WorldPoint3D[] = [];
    for (const edge of chainEdges) {
      for (const pt of edge.points3D) {
        const last = pts3D[pts3D.length - 1];
        // Preserve near block-for-block resolution (0.6 blocks) from MAGIC curvePoints
        if (!last || Math.hypot(pt.x - last.x, pt.z - last.z) >= 0.6 || Math.abs(pt.y - last.y) >= 0.4) {
          pts3D.push({
            x: Math.round(pt.x * 10) / 10,
            y: Math.round(pt.y * 10) / 10,
            z: Math.round(pt.z * 10) / 10,
          });
        }
      }
    }

    return { pts3D, edgeCount: chainEdges.length };
  };

  let routesTracedFromMagicRails = 0;
  let routesSmoothedFromMagic3D = 0;

  const tracedRoutes = routes.map((route) => {
    if (route.stops.length < 2) return route;
    const normRouteId = normalizeMagicId(route.id);
    const hasTaggedRails = (routeNodeSet.get(normRouteId)?.size ?? 0) >= 2;

    const stitched3D: WorldPoint3D[] = [];
    let magicSegmentsUsed = 0;

    for (let i = 0; i < route.stops.length - 1; i++) {
      const a = route.stops[i];
      const b = route.stops[i + 1];
      const ay = Number.isFinite(a.y) ? a.y : SERVER_GROUND_Y;
      const by = Number.isFinite(b.y) ? b.y : SERVER_GROUND_Y;
      const directDist = Math.hypot(b.x - a.x, b.z - a.z);

      if (i === 0) stitched3D.push({ x: a.x, y: ay, z: a.z });

      const startNode = findClosestRailNode(a.x, ay, a.z, normRouteId, 140);
      const goalNode = findClosestRailNode(b.x, by, b.z, normRouteId, 140);

      let segmentTraced = false;
      if (startNode !== null && goalNode !== null) {
        // Stage 1: Exact route-tagged subgraph A* (100% locked to this route's MAGIC rails!)
        let res = hasTaggedRails
          ? traceRailSegmentAStar(
              startNode,
              goalNode,
              normRouteId,
              Math.max(1200, directDist * 4.5),
              true
            )
          : null;

        // Stage 2: Full-network A* fallback (bridges any untagged switch/platform rail)
        if (!res) {
          res = traceRailSegmentAStar(
            startNode,
            goalNode,
            normRouteId,
            Math.max(900, directDist * 3.8),
            false
          );
        }

        if (res && res.pts3D.length >= 2) {
          for (const pt of res.pts3D) {
            const last = stitched3D[stitched3D.length - 1];
            if (!last || Math.hypot(pt.x - last.x, pt.z - last.z) >= 0.65) {
              stitched3D.push(pt);
            }
          }
          magicSegmentsUsed += Math.max(1, res.edgeCount);
          segmentTraced = true;
        }
      }

      if (!segmentTraced) {
        const last = stitched3D[stitched3D.length - 1];
        if (!last || Math.hypot(b.x - last.x, b.z - last.z) > 2) {
          stitched3D.push({ x: b.x, y: by, z: b.z });
        }
      } else {
        const last = stitched3D[stitched3D.length - 1];
        if (!last || Math.hypot(b.x - last.x, b.z - last.z) > 14) {
          stitched3D.push({ x: b.x, y: by, z: b.z });
        }
      }
    }

    const cleaned3D = removePathVortices3D(stitched3D, { minPointGap: 0.65 });
    const final3D =
      magicSegmentsUsed > 0
        ? smoothMagicBlockExact3D(cleaned3D, 0.35)
        : smoothMagic3DPath(cleaned3D, 3);

    if (magicSegmentsUsed > 0) {
      routesTracedFromMagicRails++;
    } else {
      routesSmoothedFromMagic3D++;
    }

    return {
      ...route,
      tracedPath: final3D.map((p): WorldPoint => ({ x: p.x, z: p.z })),
      tracedPath3D: final3D,
      magicSmoothed: true,
      magicTraced: magicSegmentsUsed > 0,
      magicRailSegments: magicSegmentsUsed,
      snappedToStreets: false,
      corridorOffset: 0,
    };
  });

  const connectedRoutes = connectBidirectionalRouteTermini(
    tracedRoutes,
    (fromPt, toPt, routeId, maxBudget) => {
      const normId = normalizeMagicId(routeId);
      const startNode = findClosestRailNode(fromPt.x, fromPt.y, fromPt.z, normId, 90);
      const goalNode = findClosestRailNode(toPt.x, toPt.y, toPt.z, normId, 90);
      if (startNode === null || goalNode === null || startNode === goalNode) return null;
      const res = traceRailSegmentAStar(startNode, goalNode, normId, maxBudget);
      return res && res.pts3D.length >= 2 ? res.pts3D : null;
    }
  );

  return {
    routes: connectedRoutes,
    railsLoaded: rails.length,
    routesTracedFromMagicRails,
    routesSmoothedFromMagic3D,
    totalRoutes: routes.length,
    liveVehiclesCount,
  };
}

function getRoutePath3D(route: MtrRoute): WorldPoint3D[] {
  if (route.tracedPath3D && route.tracedPath3D.length >= 2) {
    return route.tracedPath3D;
  }
  if (route.tracedPath && route.tracedPath.length >= 2) {
    const baseY = route.stops[0]?.y ?? SERVER_GROUND_Y;
    return route.tracedPath.map((p) => ({ x: p.x, y: baseY, z: p.z }));
  }
  return route.stops.map((s) => ({
    x: s.x,
    y: Number.isFinite(s.y) ? s.y : SERVER_GROUND_Y,
    z: s.z,
  }));
}

function polylineLength2D(pts: WorldPoint3D[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return sum;
}

function getLineGroupKey(route: MtrRoute): string {
  const num = route.number?.trim().toLowerCase();
  if (num && num !== '•') {
    return `${route.kind}|${num}`;
  }
  return `${route.kind}|${(route.shortName || route.name).trim().toLowerCase()}`;
}

/**
 * Connects broken depot / turnaround gaps where the terminus of one direction
 * sits right next to the start of its paired reverse direction (e.g. Т5 at Вакса depot,
 * Т2, Т12, Т7, Тр5, Автобус 52/60/61/62), and closes ring/circular lines whose end
 * approaches their start.
 *
 * Preserves all original stops, schedules, and durations — only extends the visual/traced
 * 3D geometry smoothly across the terminal loop.
 */
export function connectBidirectionalRouteTermini(
  routes: MtrRoute[],
  railSegmentTracer?: (
    from: WorldPoint3D,
    to: WorldPoint3D,
    routeId: string,
    maxBudget: number
  ) => WorldPoint3D[] | null,
  maxTerminusGapBlocks = 360
): MtrRoute[] {
  if (routes.length === 0) return routes;

  const paths = routes.map(getRoutePath3D);
  const groups = new Map<string, number[]>();
  routes.forEach((rt, idx) => {
    if (rt.stops.length < 2 || paths[idx].length < 2) return;
    const key = getLineGroupKey(rt);
    const list = groups.get(key);
    if (list) list.push(idx);
    else groups.set(key, [idx]);
  });

  const appendConnector = (
    base: WorldPoint3D[],
    connector: WorldPoint3D[],
    targetEnd: WorldPoint3D
  ): WorldPoint3D[] => {
    const out = [...base];
    for (const pt of connector) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.z - last.z) > 1.5) {
        out.push(pt);
      }
    }
    const last = out[out.length - 1];
    if (!last || Math.hypot(targetEnd.x - last.x, targetEnd.z - last.z) > 2) {
      out.push(targetEnd);
    }
    return out;
  };

  return routes.map((route, idx) => {
    const pathA = paths[idx];
    if (route.stops.length < 2 || pathA.length < 2) return route;

    const aFirst = pathA[0];
    const aLast = pathA[pathA.length - 1];
    const routeSpan = Math.hypot(aLast.x - aFirst.x, aLast.z - aFirst.z);
    const totalLen = polylineLength2D(pathA);

    // 1. Ring / circular route whose end approaches its own start (e.g. кольцевой автобус К)
    const selfGap = routeSpan;
    const looksCircular =
      route.circular ||
      /кольц/i.test(route.name) ||
      (route.stops.length >= 6 && totalLen > 1200 && selfGap < totalLen * 0.16);

    if (looksCircular && selfGap > 4 && selfGap <= maxTerminusGapBlocks) {
      const railPts =
        railSegmentTracer?.(aLast, aFirst, route.id, Math.max(260, selfGap * 2.4)) ?? null;
      const connector =
        railPts && railPts.length >= 2
          ? railPts.slice(1)
          : buildTurnaroundConnector3D(pathA, pathA);
      if (connector.length > 0) {
        const merged3D = appendConnector(pathA, connector, aFirst);
        return {
          ...route,
          tracedPath: merged3D.map((p): WorldPoint => ({ x: p.x, z: p.z })),
          tracedPath3D: merged3D,
        };
      }
    }

    // 2. Paired opposite-direction route of the same line (depot / terminal turnaround loop)
    if (routeSpan < 160) return route;
    const peers = groups.get(getLineGroupKey(route)) ?? [];
    if (peers.length < 2) return route;

    let bestPartnerIdx = -1;
    let bestScore = Infinity;

    for (const pIdx of peers) {
      if (pIdx === idx) continue;
      const partner = routes[pIdx];
      const pathB = paths[pIdx];
      if (partner.stops.length < 2 || pathB.length < 2) continue;

      const bFirst = pathB[0];
      const bLast = pathB[pathB.length - 1];

      const gapEndToStart = Math.hypot(aLast.x - bFirst.x, aLast.z - bFirst.z);
      if (gapEndToStart <= 4 || gapEndToStart > maxTerminusGapBlocks) continue;
      if (gapEndToStart > routeSpan * 0.45) continue;

      const gapBackEndToStart = Math.hypot(bLast.x - aFirst.x, bLast.z - aFirst.z);
      const oppDirDist = gapEndToStart + gapBackEndToStart;
      const sameDirDist =
        Math.hypot(aFirst.x - bFirst.x, aFirst.z - bFirst.z) +
        Math.hypot(aLast.x - bLast.x, aLast.z - bLast.z);

      // Must genuinely be an opposite-direction return trip (not a parallel same-direction variant)
      if (oppDirDist >= sameDirDist * 0.72) continue;

      // Prefer the partner that matches both termini most tightly
      const score = gapEndToStart + gapBackEndToStart * 0.35;
      if (score < bestScore) {
        bestScore = score;
        bestPartnerIdx = pIdx;
      }
    }

    if (bestPartnerIdx === -1) return route;

    const pathB = paths[bestPartnerIdx];
    const bFirst = pathB[0];
    const gap = Math.hypot(aLast.x - bFirst.x, aLast.z - bFirst.z);

    const railPts =
      railSegmentTracer?.(aLast, bFirst, route.id, Math.max(260, gap * 2.5)) ?? null;
    const connector =
      railPts && railPts.length >= 2
        ? railPts.slice(1)
        : buildTurnaroundConnector3D(pathA, pathB);

    if (connector.length === 0) return route;

    const merged3D = appendConnector(pathA, connector, bFirst);
    return {
      ...route,
      tracedPath: merged3D.map((p): WorldPoint => ({ x: p.x, z: p.z })),
      tracedPath3D: merged3D,
    };
  });
}

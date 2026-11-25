import type {
  Building3D,
  ComputedRoute,
  DepartureInfo,
  LandFeature,
  MtrRoute,
  MtrStation,
  RoadClass,
  RouteEndpoint,
  RouteLeg,
  SimVehicleType,
  StreetSegment,
  TransportKind,
  WorldPoint,
} from '../types/map';
import { getBuildingWings } from './buildingOps';
import { smoothStreetPolyline } from './geometry';
import { getNextDepartureWaitSec } from './scheduleSync';

/**
 * Predefined speed constants calibrated for the MURS Minecraft server (1 block = 1 meter).
 * Matches real Minecraft player kinematics and live MTR vehicle durations from map.murs-mc.ru.
 */
export const WALK_SPEED_BLOCKS_PER_SEC = 4.3; // Standard Minecraft walking pace
export const WALK_SPRINT_SPEED_BLOCKS_PER_SEC = 5.6; // Minecraft sprinting pace

export const MURS_SPEED_CONSTANTS = {
  walk: { label: 'Пешком (шаг)', speedBlocksPerSec: 4.3 },
  walkSprint: { label: 'Пешком (бег)', speedBlocksPerSec: 5.6 },
  bike: { label: 'Велосипед', speedBlocksPerSec: 8.8 },
  scooter: { label: 'Электросамокат (СИМ)', speedBlocksPerSec: 10.5 },
  ebike: { label: 'Электровелосипед (СИМ)', speedBlocksPerSec: 12.8 },
  auto: { label: 'Автомобиль', speedBlocksPerSec: 18.5 },
  bus: { label: 'Автобус', speedBlocksPerSec: 12.5 },
  trolleybus: { label: 'Троллейбус', speedBlocksPerSec: 12.0 },
  tram: { label: 'Трамвай', speedBlocksPerSec: 13.0 },
  metro: { label: 'Метро', speedBlocksPerSec: 24.0 },
  rail: { label: 'Электричка', speedBlocksPerSec: 28.0 },
} as const;

export const SIM_PROFILES: Record<
  SimVehicleType,
  { label: string; shortLabel: string; speedBlocksPerSec: number; offroadFactor: number }
> = {
  scooter: {
    label: 'Электросамокат',
    shortLabel: 'Самокат',
    speedBlocksPerSec: MURS_SPEED_CONSTANTS.scooter.speedBlocksPerSec,
    offroadFactor: 0.55,
  },
  bike: {
    label: 'Велосипед',
    shortLabel: 'Велосипед',
    speedBlocksPerSec: MURS_SPEED_CONSTANTS.bike.speedBlocksPerSec,
    offroadFactor: 0.72,
  },
  ebike: {
    label: 'Электровелосипед',
    shortLabel: 'Электровел',
    speedBlocksPerSec: MURS_SPEED_CONSTANTS.ebike.speedBlocksPerSec,
    offroadFactor: 0.65,
  },
};

export function getTransportLabelRu(kind: TransportKind): string {
  switch (kind) {
    case 'metro':
      return 'Метро';
    case 'tram':
      return 'Трамвай';
    case 'trolleybus':
      return 'Троллейбус';
    case 'bus':
      return 'Автобус';
    case 'rail':
      return 'Электричка';
    case 'cable':
      return 'Канатная дорога';
    case 'boat':
      return 'Водный транспорт';
    case 'plane':
      return 'Авиатранспорт';
  }
}

export function formatDurationRu(totalSec: number): string {
  const sec = Math.max(10, Math.round(totalSec));
  if (sec < 60) {
    return `${sec} сек`;
  }
  const mins = Math.round(sec / 60);
  if (mins < 60) {
    return `${mins} мин`;
  }
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${h} ч` : `${h} ч ${rem} мин`;
}

export function formatDistanceRu(blocks: number): string {
  const b = Math.round(blocks);
  if (b < 1000) {
    return `${b} м`;
  }
  return `${(b / 1000).toFixed(1).replace('.', ',')} км`;
}

export function dist2D(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

interface ObstaclePolygon {
  points: WorldPoint[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function pointInPolygon2D(px: number, pz: number, poly: WorldPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect =
      zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToPolyEdgeDist(px: number, pz: number, poly: WorldPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const t =
      lenSq < 1e-6 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq));
    const d = Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
    if (d < best) best = d;
  }
  return best;
}

function segsCross2D(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): boolean {
  const orient = (p: WorldPoint, q: WorldPoint, r: WorldPoint) =>
    (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

function segmentHitsObstacle(
  a: WorldPoint,
  b: WorldPoint,
  obs: ObstaclePolygon,
  clearance = 0
): boolean {
  const sMinX = Math.min(a.x, b.x) - clearance;
  const sMaxX = Math.max(a.x, b.x) + clearance;
  const sMinZ = Math.min(a.z, b.z) - clearance;
  const sMaxZ = Math.max(a.z, b.z) + clearance;
  if (sMaxX < obs.minX || sMinX > obs.maxX || sMaxZ < obs.minZ || sMinZ > obs.maxZ) {
    return false;
  }

  const poly = obs.points;
  // Check interior samples along segment (catches segments fully inside or skimming clearance)
  const segLen = Math.hypot(b.x - a.x, b.z - a.z);
  const samples = Math.max(2, Math.min(16, Math.ceil(segLen / 10)));
  for (let s = 1; s < samples; s++) {
    const f = s / samples;
    const sx = a.x + (b.x - a.x) * f;
    const sz = a.z + (b.z - a.z) * f;
    if (pointInPolygon2D(sx, sz, poly)) return true;
    if (clearance > 0 && pointToPolyEdgeDist(sx, sz, poly) < clearance) return true;
  }

  // Exact edge-edge intersection check
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    if (segsCross2D(a, b, p1, p2)) return true;
  }
  return false;
}

function collectObstaclesInBox(
  buildings: Building3D[],
  landFeatures: LandFeature[],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): ObstaclePolygon[] {
  const out: ObstaclePolygon[] = [];

  const addPoly = (pts: WorldPoint[]) => {
    if (pts.length < 3) return;
    let bMinX = Infinity;
    let bMaxX = -Infinity;
    let bMinZ = Infinity;
    let bMaxZ = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < bMinX) bMinX = p.x;
      if (p.x > bMaxX) bMaxX = p.x;
      if (p.z < bMinZ) bMinZ = p.z;
      if (p.z > bMaxZ) bMaxZ = p.z;
    }
    if (bMaxX < minX || bMinX > maxX || bMaxZ < minZ || bMinZ > maxZ) return;
    out.push({ points: pts, minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ });
  };

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const wings = getBuildingWings(b);
    for (let w = 0; w < wings.length; w++) {
      addPoly(wings[w].footprint);
    }
  }

  for (let i = 0; i < landFeatures.length; i++) {
    const f = landFeatures[i];
    if (f.kind === 'water') {
      addPoly(f.polygon);
    }
  }

  return out;
}

/**
 * Computes a collision-free detour around 3D buildings (all wings) and water polygons
 * whenever a direct segment crosses obstacles and no road is available nearby.
 * Uses an adaptive local 8-connected A* navigation grid + visibility string-pulling.
 */
export function routeAroundObstacles(
  from: WorldPoint,
  to: WorldPoint,
  buildings: Building3D[] = [],
  landFeatures: LandFeature[] = [],
  clearance = 3.5
): WorldPoint[] {
  if (buildings.length === 0 && landFeatures.length === 0) {
    return [from, to];
  }
  const directDist = dist2D(from, to);
  if (directDist < 2) return [from, to];

  const pad = Math.min(340, Math.max(100, directDist * 0.4));
  const minX = Math.min(from.x, to.x) - pad;
  const maxX = Math.max(from.x, to.x) + pad;
  const minZ = Math.min(from.z, to.z) - pad;
  const maxZ = Math.max(from.z, to.z) + pad;

  const obstacles = collectObstaclesInBox(buildings, landFeatures, minX, maxX, minZ, maxZ);
  if (obstacles.length === 0) return [from, to];

  // Fast exit: if direct line-of-sight is completely clear, no detour needed
  let directBlocked = false;
  for (let i = 0; i < obstacles.length; i++) {
    if (segmentHitsObstacle(from, to, obstacles[i], clearance * 0.4)) {
      directBlocked = true;
      break;
    }
  }
  if (!directBlocked) return [from, to];

  // Build adaptive local navigation grid (max 88x88 cells for < 4ms latency)
  const spanX = Math.max(20, maxX - minX);
  const spanZ = Math.max(20, maxZ - minZ);
  const maxSpan = Math.max(spanX, spanZ);
  const cellSize = Math.max(3, Math.ceil(maxSpan / 84));
  const cols = Math.min(92, Math.max(8, Math.ceil(spanX / cellSize)));
  const rows = Math.min(92, Math.max(8, Math.ceil(spanZ / cellSize)));

  const blocked = new Uint8Array(cols * rows);
  const inflate = Math.max(clearance, cellSize * 0.55);

  for (let o = 0; o < obstacles.length; o++) {
    const obs = obstacles[o];
    const c0 = Math.max(0, Math.floor((obs.minX - inflate - minX) / cellSize));
    const c1 = Math.min(cols - 1, Math.ceil((obs.maxX + inflate - minX) / cellSize));
    const r0 = Math.max(0, Math.floor((obs.minZ - inflate - minZ) / cellSize));
    const r1 = Math.min(rows - 1, Math.ceil((obs.maxZ + inflate - minZ) / cellSize));
    for (let r = r0; r <= r1; r++) {
      const wz = minZ + (r + 0.5) * cellSize;
      for (let c = c0; c <= c1; c++) {
        const idx = r * cols + c;
        if (blocked[idx]) continue;
        const wx = minX + (c + 0.5) * cellSize;
        if (
          pointInPolygon2D(wx, wz, obs.points) ||
          pointToPolyEdgeDist(wx, wz, obs.points) < inflate
        ) {
          blocked[idx] = 1;
        }
      }
    }
  }

  const clampC = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cellSize)));
  const clampR = (z: number) => Math.max(0, Math.min(rows - 1, Math.floor((z - minZ) / cellSize)));

  const startC = clampC(from.x);
  const startR = clampR(from.z);
  const goalC = clampC(to.x);
  const goalR = clampR(to.z);

  // If an endpoint sits inside a building/clearance halo, snap it to nearest free cell
  const findNearestFree = (sc: number, sr: number): number => {
    const baseIdx = sr * cols + sc;
    if (!blocked[baseIdx]) return baseIdx;
    for (let rad = 1; rad <= 12; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
          const nr = sr + dr;
          const nc = sc + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (!blocked[ni]) return ni;
        }
      }
    }
    blocked[baseIdx] = 0;
    return baseIdx;
  };

  const startIdx = findNearestFree(startC, startR);
  const goalIdx = findNearestFree(goalC, goalR);
  if (startIdx === goalIdx) return [from, to];

  const gScore = new Float32Array(cols * rows);
  gScore.fill(Infinity);
  const parent = new Int32Array(cols * rows);
  parent.fill(-1);
  const closed = new Uint8Array(cols * rows);

  const gR = Math.floor(goalIdx / cols);
  const gC = goalIdx % cols;
  const heuristic = (idx: number) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const dx = Math.abs(c - gC);
    const dz = Math.abs(r - gR);
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * cellSize;
  };

  const heap: Array<{ idx: number; f: number }> = [{ idx: startIdx, f: heuristic(startIdx) }];
  gScore[startIdx] = 0;

  const push = (item: { idx: number; f: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let sm = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < heap.length && heap[l].f < heap[sm].f) sm = l;
        if (r < heap.length && heap[r].f < heap[sm].f) sm = r;
        if (sm === i) break;
        [heap[i], heap[sm]] = [heap[sm], heap[i]];
        i = sm;
      }
    }
    return top;
  };

  const dirs: Array<[number, number, number]> = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];

  let found = false;
  let iters = 0;
  while (heap.length > 0 && iters < cols * rows * 2) {
    iters++;
    const cur = pop();
    if (cur.idx === goalIdx) {
      found = true;
      break;
    }
    if (closed[cur.idx]) continue;
    closed[cur.idx] = 1;

    const cr = Math.floor(cur.idx / cols);
    const cc = cur.idx % cols;
    const curG = gScore[cur.idx];

    for (let d = 0; d < dirs.length; d++) {
      const [dc, dr, stepCost] = dirs[d];
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (closed[nIdx] || blocked[nIdx]) continue;
      // Prevent diagonal corner-cutting through obstacle corners
      if (dc !== 0 && dr !== 0 && (blocked[cr * cols + nc] || blocked[nr * cols + cc])) {
        continue;
      }
      const nextG = curG + stepCost * cellSize;
      if (nextG < gScore[nIdx]) {
        gScore[nIdx] = nextG;
        parent[nIdx] = cur.idx;
        push({ idx: nIdx, f: nextG + heuristic(nIdx) });
      }
    }
  }

  if (!found) {
    return [from, to];
  }

  // Reconstruct grid path
  const gridPts: WorldPoint[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    gridPts.push({
      x: minX + (c + 0.5) * cellSize,
      z: minZ + (r + 0.5) * cellSize,
    });
    if (cur === startIdx) break;
    cur = parent[cur];
  }
  gridPts.reverse();

  const rawPath: WorldPoint[] = [from, ...gridPts, to];

  // Line-of-sight string-pulling so path hugs corners cleanly without grid stair-stepping
  const isSegmentClear = (a: WorldPoint, b: WorldPoint) => {
    for (let i = 0; i < obstacles.length; i++) {
      if (segmentHitsObstacle(a, b, obstacles[i], clearance * 0.45)) return false;
    }
    return true;
  };

  const pulled: WorldPoint[] = [rawPath[0]];
  let anchor = 0;
  while (anchor < rawPath.length - 1) {
    let farthest = anchor + 1;
    for (let probe = rawPath.length - 1; probe > anchor + 1; probe--) {
      if (isSegmentClear(rawPath[anchor], rawPath[probe])) {
        farthest = probe;
        break;
      }
    }
    pulled.push(rawPath[farthest]);
    anchor = farthest;
  }

  if (pulled.length <= 2) return pulled;

  // Apply gentle constant-curvature rounding if the smoothed version stays collision-free
  const smoothed = smoothStreetPolyline(pulled, Math.min(12, cellSize * 2), 3);
  let smoothClear = true;
  for (let i = 0; i < smoothed.length - 1; i++) {
    if (!isSegmentClear(smoothed[i], smoothed[i + 1])) {
      smoothClear = false;
      break;
    }
  }
  return smoothClear ? smoothed : pulled;
}

function polylineDist2D(pts: WorldPoint[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    sum += dist2D(pts[i - 1], pts[i]);
  }
  return sum;
}

interface StreetGraphNode {
  id: string;
  x: number;
  z: number;
  streetName?: string;
  edges: Array<{
    to: string;
    dist: number;
    roadFactor: number;
    roadClass?: RoadClass;
    streetName?: string;
    simAllowed: boolean;
    offRoad?: boolean;
  }>;
}

/**
 * Builds a connected street graph from vector street segments by merging
 * nearby intersection vertices and snapping start/end points.
 */
function buildStreetGraph(
  streets: StreetSegment[],
  start: WorldPoint,
  end: WorldPoint,
  mode: 'walk' | 'sim' | 'auto'
): Map<string, StreetGraphNode> {
  const nodes = new Map<string, StreetGraphNode>();
  const MERGE_TOLERANCE = 42;

  const findOrCreateNode = (x: number, z: number, streetName?: string): string => {
    for (const n of nodes.values()) {
      if (Math.hypot(n.x - x, n.z - z) <= MERGE_TOLERANCE) {
        return n.id;
      }
    }
    const id = `n_${nodes.size}`;
    nodes.set(id, { id, x, z, streetName, edges: [] });
    return id;
  };

  for (const st of streets) {
    if (st.points.length < 2 || st.roadClass === 'railway') continue;
    if (mode === 'auto' && st.roadClass === 'pedestrian') continue;

    const roadFactor =
      mode === 'auto'
        ? st.roadClass === 'highway'
          ? 0.82
          : st.roadClass === 'avenue'
          ? 0.95
          : st.roadClass === 'street' || st.roadClass === 'embankment'
          ? 1.12
          : st.roadClass === 'service'
          ? 1.48
          : st.roadClass === 'dirt'
          ? 1.72
          : 1.38
        : st.roadClass === 'highway'
        ? 0.95
        : st.roadClass === 'avenue'
        ? 1.0
        : st.roadClass === 'street' || st.roadClass === 'embankment'
        ? 1.03
        : st.roadClass === 'lane' || st.roadClass === 'service'
        ? 1.08
        : st.roadClass === 'dirt'
        ? 1.18
        : 1.15;

    // Cars strictly obey one-way street directions; pedestrians & SIM may use sidewalks in either direction
    const allowForward = mode !== 'auto' || st.oneWay !== 'reverse';
    const allowReverse = mode !== 'auto' || st.oneWay !== 'forward';

    let prevId = findOrCreateNode(st.points[0].x, st.points[0].z, st.name);
    for (let i = 1; i < st.points.length; i++) {
      const currId = findOrCreateNode(st.points[i].x, st.points[i].z, st.name);
      if (currId !== prevId) {
        const a = nodes.get(prevId)!;
        const b = nodes.get(currId)!;
        const d = dist2D(a, b);
        if (allowForward) {
          a.edges.push({
            to: currId,
            dist: d,
            roadFactor,
            roadClass: st.roadClass,
            streetName: st.name,
            simAllowed: st.simAllowed,
            offRoad: false,
          });
        }
        if (allowReverse) {
          b.edges.push({
            to: prevId,
            dist: d,
            roadFactor,
            roadClass: st.roadClass,
            streetName: st.name,
            simAllowed: st.simAllowed,
            offRoad: false,
          });
        }
      }
      prevId = currId;
    }
  }

  // Link close street endpoints (crosswalks / courtyard connections)
  const existingNodes = Array.from(nodes.values());
  const linkRadius = mode === 'auto' ? 140 : 220;
  for (let i = 0; i < existingNodes.length; i++) {
    for (let j = i + 1; j < existingNodes.length; j++) {
      const a = existingNodes[i];
      const b = existingNodes[j];
      const d = dist2D(a, b);
      if (
        d <= linkRadius &&
        !a.edges.some((e) => e.to === b.id) &&
        !b.edges.some((e) => e.to === a.id)
      ) {
        a.edges.push({
          to: b.id,
          dist: d,
          roadFactor: mode === 'auto' ? 2.6 : 1.25,
          simAllowed: true,
          offRoad: true,
        });
        b.edges.push({
          to: a.id,
          dist: d,
          roadFactor: mode === 'auto' ? 2.6 : 1.25,
          simAllowed: true,
          offRoad: true,
        });
      }
    }
  }

  const startNode: StreetGraphNode = { id: '__start', x: start.x, z: start.z, edges: [] };
  const endNode: StreetGraphNode = { id: '__end', x: end.x, z: end.z, edges: [] };
  nodes.set('__start', startNode);
  nodes.set('__end', endNode);

  // Connect __start and __end to nearest street nodes
  const connectTerminal = (term: StreetGraphNode) => {
    const sorted = existingNodes
      .map((n) => ({ n, d: dist2D(term, n) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    for (const { n, d } of sorted) {
      if (d <= 2200) {
        const factor = mode === 'auto' ? 1.55 : 1.18;
        term.edges.push({ to: n.id, dist: d, roadFactor: factor, simAllowed: true, offRoad: true });
        n.edges.push({ to: term.id, dist: d, roadFactor: factor, simAllowed: true, offRoad: true });
      }
    }
  };
  connectTerminal(startNode);
  connectTerminal(endNode);

  // Direct fallback edge (penalized so real streets are strongly preferred when available)
  const directDist = dist2D(start, end);
  startNode.edges.push({
    to: '__end',
    dist: directDist,
    roadFactor: mode === 'auto' ? 2.2 : 1.38,
    simAllowed: true,
    offRoad: true,
  });

  return nodes;
}

/**
 * Computes Walking, SIM, or Car ('auto') route over the vector street network,
 * automatically routing off-road stretches around 3D buildings and water obstacles.
 */
export function computeStreetRoute(
  start: RouteEndpoint,
  end: RouteEndpoint,
  streets: StreetSegment[],
  mode: 'walk' | 'sim' | 'auto',
  simVehicle: SimVehicleType = 'scooter',
  buildings: Building3D[] = [],
  landFeatures: LandFeature[] = [],
  departureEpochMs = Date.now()
): ComputedRoute {
  const graph = buildStreetGraph(streets, start, end, mode);
  const profile = SIM_PROFILES[simVehicle];
  const baseSpeed =
    mode === 'walk'
      ? WALK_SPEED_BLOCKS_PER_SEC
      : mode === 'auto'
      ? MURS_SPEED_CONSTANTS.auto.speedBlocksPerSec
      : profile.speedBlocksPerSec;

  const distTime = new Map<string, number>();
  const prev = new Map<
    string,
    { nodeId: string; streetName?: string; dist: number; offRoad?: boolean }
  >();
  const visited = new Set<string>();

  distTime.set('__start', 0);

  while (true) {
    let currId: string | null = null;
    let bestT = Infinity;
    for (const [id, t] of distTime.entries()) {
      if (!visited.has(id) && t < bestT) {
        bestT = t;
        currId = id;
      }
    }
    if (!currId || currId === '__end') break;
    visited.add(currId);

    const node = graph.get(currId);
    if (!node) continue;

    for (const edge of node.edges) {
      if (visited.has(edge.to)) continue;
      let speed = baseSpeed / edge.roadFactor;
      if (mode === 'sim' && !edge.simAllowed) {
        speed = WALK_SPEED_BLOCKS_PER_SEC * 0.95;
      } else if (mode === 'sim' && !edge.streetName) {
        speed = baseSpeed * profile.offroadFactor;
      } else if (mode === 'auto' && edge.offRoad) {
        speed = baseSpeed * 0.22;
      }
      const edgeSec = edge.dist / Math.max(1, speed);
      const nextT = bestT + edgeSec;
      if (nextT < (distTime.get(edge.to) ?? Infinity)) {
        distTime.set(edge.to, nextT);
        prev.set(edge.to, {
          nodeId: currId,
          streetName: edge.streetName,
          dist: edge.dist,
          offRoad: edge.offRoad,
        });
      }
    }
  }

  // Reconstruct segments & apply collision-avoiding detours on any off-road stretches
  const rawSteps: Array<{ from: WorldPoint; to: WorldPoint; streetName?: string; offRoad: boolean }> = [];
  const streetNamesUsed = new Set<string>();

  let cur: string | undefined = '__end';
  while (cur) {
    const step = prev.get(cur);
    if (step) {
      const fromN = graph.get(step.nodeId);
      const toN = graph.get(cur);
      if (fromN && toN) {
        rawSteps.push({
          from: { x: fromN.x, z: fromN.z },
          to: { x: toN.x, z: toN.z },
          streetName: step.streetName,
          offRoad: Boolean(step.offRoad),
        });
      }
      if (step.streetName) streetNamesUsed.add(step.streetName);
      cur = step.nodeId;
    } else {
      cur = undefined;
    }
  }
  rawSteps.reverse();

  const pathPoints: WorldPoint[] = [];
  let totalBlocks = 0;
  let extraDetourSec = 0;
  const clearance = mode === 'auto' ? 4.5 : 3.0;

  for (let i = 0; i < rawSteps.length; i++) {
    const st = rawSteps[i];
    const segPts = st.offRoad
      ? routeAroundObstacles(st.from, st.to, buildings, landFeatures, clearance)
      : [st.from, st.to];

    const segDist = polylineDist2D(segPts);
    const straightDist = dist2D(st.from, st.to);
    if (segDist > straightDist + 1) {
      const detourSpeed = mode === 'auto' ? baseSpeed * 0.45 : mode === 'sim' ? baseSpeed * profile.offroadFactor : baseSpeed;
      extraDetourSec += (segDist - straightDist) / Math.max(1, detourSpeed);
    }
    totalBlocks += segDist;

    for (let k = 0; k < segPts.length; k++) {
      const pt = segPts[k];
      const last = pathPoints[pathPoints.length - 1];
      if (!last || dist2D(last, pt) > 0.8) {
        pathPoints.push(pt);
      }
    }
  }

  const fallbackPoints =
    pathPoints.length >= 2
      ? pathPoints
      : routeAroundObstacles({ x: start.x, z: start.z }, { x: end.x, z: end.z }, buildings, landFeatures, clearance);

  const finalDistance = Math.round(totalBlocks || polylineDist2D(fallbackPoints));
  const totalDurationSec = Math.max(
    12,
    Math.round((distTime.get('__end') ?? finalDistance / baseSpeed) + extraDetourSec)
  );
  const streetList = Array.from(streetNamesUsed).slice(0, 3);
  const viaText = streetList.length > 0 ? `через ${streetList.join(', ')}` : 'в обход застройки';

  const arrivalEpochMs = departureEpochMs + totalDurationSec * 1000;

  const leg: RouteLeg = {
    type: mode,
    fromName: start.label,
    toName: end.label,
    durationSec: totalDurationSec,
    departureTimeMs: departureEpochMs,
    arrivalTimeMs: arrivalEpochMs,
    distanceBlocks: finalDistance,
    points: fallbackPoints,
    instruction:
      mode === 'walk'
        ? `Идите пешком ${viaText}`
        : mode === 'auto'
        ? `Поездка на автомобиле ${viaText}`
        : `Поездка на СИМ (${profile.shortLabel.toLowerCase()}) ${viaText}`,
  };

  return {
    id: `${mode}-${simVehicle}-${Math.round(start.x)}-${Math.round(end.x)}`,
    mode,
    simVehicle: mode === 'sim' ? simVehicle : undefined,
    totalDurationSec,
    departureTimeMs: departureEpochMs,
    arrivalTimeMs: arrivalEpochMs,
    totalDistanceBlocks: leg.distanceBlocks,
    walkingDistanceBlocks: mode === 'walk' ? leg.distanceBlocks : 0,
    transfers: 0,
    legs: [leg],
    summary:
      mode === 'walk'
        ? `Пешком · ${formatDistanceRu(leg.distanceBlocks)}`
        : mode === 'auto'
        ? `На автомобиле · ${formatDistanceRu(leg.distanceBlocks)}`
        : `${profile.label} · ${formatDistanceRu(leg.distanceBlocks)}`,
  };
}

interface TransitEdge {
  to: string;
  costSec: number;
  realDurationSec: number;
  waitSec: number;
  distBlocks: number;
  kind: 'walk' | 'transit' | 'transfer';
  route?: MtrRoute;
  boardStopIdx?: number;
  modeBias?: number;
  fromStopName: string;
  toStopName: string;
  fromPt: WorldPoint;
  toPt: WorldPoint;
}

/**
 * Computes multimodal public transit route using real MTR routes, live departure schedules,
 * user's local departure time, dwell times, and obstacle-avoiding walking access/egress/transfers.
 */
export function computeTransitRoutes(
  start: RouteEndpoint,
  end: RouteEndpoint,
  stations: MtrStation[],
  routes: MtrRoute[],
  streets: StreetSegment[],
  buildings: Building3D[] = [],
  landFeatures: LandFeature[] = [],
  departureEpochMs = Date.now(),
  departuresMap?: Map<string, DepartureInfo>,
  serverClockOffsetMs = 0
): ComputedRoute[] {
  const results: ComputedRoute[] = [];

  const runSearch = (preferMetro: boolean): ComputedRoute | null => {
    const adj = new Map<string, TransitEdge[]>();
    const addEdge = (from: string, edge: TransitEdge) => {
      const list = adj.get(from);
      if (list) list.push(edge);
      else adj.set(from, [edge]);
    };

    // 1. Add MTR route ride edges & boarding/alighting edges
    for (const route of routes) {
      if (route.stops.length < 2) continue;
      const baseWaitSec = Math.max(18, Math.min(180, Math.round(route.headwaySec * 0.4)));
      const modeBias = preferMetro && route.kind !== 'metro' ? 1.35 : 1.0;

      for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i];
        const hubId = `st:${stop.stationId}`;
        const boardId = `rt:${route.id}:${i}`;

        addEdge(hubId, {
          to: boardId,
          costSec: baseWaitSec * modeBias + 8,
          realDurationSec: baseWaitSec,
          waitSec: baseWaitSec,
          distBlocks: 0,
          kind: 'transfer',
          route,
          boardStopIdx: i,
          modeBias,
          fromStopName: stop.name,
          toStopName: stop.name,
          fromPt: { x: stop.x, z: stop.z },
          toPt: { x: stop.x, z: stop.z },
        });

        addEdge(boardId, {
          to: hubId,
          costSec: 8,
          realDurationSec: 8,
          waitSec: 0,
          distBlocks: 0,
          kind: 'transfer',
          route,
          fromStopName: stop.name,
          toStopName: stop.name,
          fromPt: { x: stop.x, z: stop.z },
          toPt: { x: stop.x, z: stop.z },
        });

        if (i < route.stops.length - 1) {
          const next = route.stops[i + 1];
          const segSec = Math.max(
            6,
            ((route.segmentDurationsMs[i] ?? 25_000) + stop.dwellMs * 0.65) / 1000
          );
          const dist = dist2D(stop, next);
          addEdge(boardId, {
            to: `rt:${route.id}:${i + 1}`,
            costSec: segSec * modeBias,
            realDurationSec: segSec,
            waitSec: 0,
            distBlocks: dist,
            kind: 'transit',
            route,
            fromStopName: stop.name,
            toStopName: next.name,
            fromPt: { x: stop.x, z: stop.z },
            toPt: { x: next.x, z: next.z },
          });
        }
      }
    }

    // 2. Inter-station walking transfers
    for (let i = 0; i < stations.length; i++) {
      const a = stations[i];
      for (let j = i + 1; j < stations.length; j++) {
        const b = stations[j];
        const d = dist2D(a, b);
        const sameName = a.name.toLowerCase() === b.name.toLowerCase();
        if (d <= 260 || (sameName && d <= 450)) {
          const walkSec = Math.max(15, d / (WALK_SPEED_BLOCKS_PER_SEC * 0.85) + 12);
          addEdge(`st:${a.id}`, {
            to: `st:${b.id}`,
            costSec: walkSec + 18,
            realDurationSec: walkSec,
            waitSec: 0,
            distBlocks: d,
            kind: 'walk',
            fromStopName: a.name,
            toStopName: b.name,
            fromPt: { x: a.x, z: a.z },
            toPt: { x: b.x, z: b.z },
          });
          addEdge(`st:${b.id}`, {
            to: `st:${a.id}`,
            costSec: walkSec + 18,
            realDurationSec: walkSec,
            waitSec: 0,
            distBlocks: d,
            kind: 'walk',
            fromStopName: b.name,
            toStopName: a.name,
            fromPt: { x: b.x, z: b.z },
            toPt: { x: a.x, z: a.z },
          });
        }
      }
    }

    // 3. Access walks from Start & Egress walks to End
    const startNear = stations
      .map((s) => ({ s, d: dist2D(start, s) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 14);
    for (const { s, d } of startNear) {
      if (d <= 2600) {
        const walkSec = Math.round((d * 1.12) / WALK_SPEED_BLOCKS_PER_SEC);
        addEdge('start', {
          to: `st:${s.id}`,
          costSec: walkSec,
          realDurationSec: walkSec,
          waitSec: 0,
          distBlocks: d * 1.12,
          kind: 'walk',
          fromStopName: start.label,
          toStopName: s.name,
          fromPt: { x: start.x, z: start.z },
          toPt: { x: s.x, z: s.z },
        });
      }
    }

    const endNear = stations
      .map((s) => ({ s, d: dist2D(end, s) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 14);
    for (const { s, d } of endNear) {
      if (d <= 2600) {
        const walkSec = Math.round((d * 1.12) / WALK_SPEED_BLOCKS_PER_SEC);
        addEdge(`st:${s.id}`, {
          to: 'end',
          costSec: walkSec,
          realDurationSec: walkSec,
          waitSec: 0,
          distBlocks: d * 1.12,
          kind: 'walk',
          fromStopName: s.name,
          toStopName: end.label,
          fromPt: { x: s.x, z: s.z },
          toPt: { x: end.x, z: end.z },
        });
      }
    }

    // Direct walk fallback if very close
    const directDist = dist2D(start, end) * 1.15;
    addEdge('start', {
      to: 'end',
      costSec: directDist / WALK_SPEED_BLOCKS_PER_SEC + 45,
      realDurationSec: directDist / WALK_SPEED_BLOCKS_PER_SEC,
      waitSec: 0,
      distBlocks: directDist,
      kind: 'walk',
      fromStopName: start.label,
      toStopName: end.label,
      fromPt: { x: start.x, z: start.z },
      toPt: { x: end.x, z: end.z },
    });

    // Time-dependent Dijkstra with min-heap (uses real MTR schedule departures at arrival clock time)
    const distMap = new Map<string, number>();
    const elapsedMap = new Map<string, number>();
    const prevMap = new Map<
      string,
      { from: string; edge: TransitEdge; actualWaitSec: number; isScheduled: boolean }
    >();
    const heap: Array<{ id: string; cost: number }> = [{ id: 'start', cost: 0 }];
    distMap.set('start', 0);
    elapsedMap.set('start', 0);

    const pushHeap = (item: { id: string; cost: number }) => {
      heap.push(item);
      let idx = heap.length - 1;
      while (idx > 0) {
        const p = (idx - 1) >> 1;
        if (heap[p].cost <= heap[idx].cost) break;
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
          let smallest = idx;
          const l = 2 * idx + 1;
          const r = 2 * idx + 2;
          if (l < heap.length && heap[l].cost < heap[smallest].cost) smallest = l;
          if (r < heap.length && heap[r].cost < heap[smallest].cost) smallest = r;
          if (smallest === idx) break;
          [heap[idx], heap[smallest]] = [heap[smallest], heap[idx]];
          idx = smallest;
        }
      }
      return top;
    };

    while (heap.length > 0) {
      const curr = popHeap();
      if (curr.cost > (distMap.get(curr.id) ?? Infinity)) continue;
      if (curr.id === 'end') break;

      const currElapsedSec = elapsedMap.get(curr.id) ?? 0;
      const edges = adj.get(curr.id);
      if (!edges) continue;
      for (const edge of edges) {
        let edgeCost = edge.costSec;
        let edgeRealSec = edge.realDurationSec;
        let actualWaitSec = edge.waitSec;
        let isScheduled = false;

        if (
          edge.kind === 'transfer' &&
          edge.route &&
          edge.boardStopIdx !== undefined
        ) {
          const arrivalAtStopScheduleMs =
            departureEpochMs + serverClockOffsetMs + currElapsedSec * 1000;
          const nextDep = getNextDepartureWaitSec(
            edge.route,
            edge.boardStopIdx,
            arrivalAtStopScheduleMs,
            departuresMap?.get(edge.route.id)
          );
          actualWaitSec = nextDep.waitSec;
          isScheduled = nextDep.isScheduled;
          // Cap optimization penalty for very long sparse-schedule gaps to 25 min while keeping real wait accurate
          const effectiveCostWait = Math.min(actualWaitSec, 1500);
          edgeCost = effectiveCostWait * (edge.modeBias ?? 1) + 8;
          edgeRealSec = actualWaitSec;
        }

        const nextCost = curr.cost + edgeCost;
        if (nextCost < (distMap.get(edge.to) ?? Infinity)) {
          distMap.set(edge.to, nextCost);
          elapsedMap.set(edge.to, currElapsedSec + edgeRealSec);
          prevMap.set(edge.to, { from: curr.id, edge, actualWaitSec, isScheduled });
          pushHeap({ id: edge.to, cost: nextCost });
        }
      }
    }

    if (!prevMap.has('end')) return null;

    const rawSteps: Array<{ edge: TransitEdge; actualWaitSec: number; isScheduled: boolean }> = [];
    let cur = 'end';
    while (cur !== 'start') {
      const step = prevMap.get(cur);
      if (!step) break;
      rawSteps.push({
        edge: step.edge,
        actualWaitSec: step.actualWaitSec,
        isScheduled: step.isScheduled,
      });
      cur = step.from;
    }
    rawSteps.reverse();

    const legs: RouteLeg[] = [];
    let pendingWaitSec = 0;
    let pendingScheduled = false;

    for (const step of rawSteps) {
      const e = step.edge;
      if (e.kind === 'transfer') {
        if (e.boardStopIdx !== undefined && e.route) {
          pendingWaitSec = step.actualWaitSec;
          pendingScheduled = step.isScheduled;
        }
        continue;
      }

      if (e.kind === 'transit' && e.route) {
        const lastLeg = legs[legs.length - 1];
        if (lastLeg && lastLeg.type === 'transit' && lastLeg.routeId === e.route.id) {
          lastLeg.toName = e.toStopName;
          lastLeg.durationSec += e.realDurationSec;
          lastLeg.distanceBlocks += e.distBlocks;
          lastLeg.points.push(e.toPt);
          lastLeg.stopsCount = (lastLeg.stopsCount ?? 1) + 1;
          lastLeg.stopNames = [...(lastLeg.stopNames ?? []), e.toStopName];
        } else {
          legs.push({
            type: 'transit',
            fromName: e.fromStopName,
            toName: e.toStopName,
            durationSec: e.realDurationSec + pendingWaitSec,
            waitSec: pendingWaitSec > 0 ? Math.round(pendingWaitSec) : 0,
            scheduledDeparture: pendingScheduled,
            distanceBlocks: e.distBlocks,
            points: [e.fromPt, e.toPt],
            routeId: e.route.id,
            routeNumber: e.route.number,
            routeName: e.route.name,
            routeColor: e.route.color,
            transportKind: e.route.kind,
            stopsCount: 1,
            stopNames: [e.fromStopName, e.toStopName],
            instruction: `${getTransportLabelRu(e.route.kind)} ${e.route.number} до «${e.toStopName}»`,
          });
          pendingWaitSec = 0;
          pendingScheduled = false;
        }
      } else if (e.kind === 'walk') {
        if (e.distBlocks < 12) continue;
        // Route walking segment around buildings & water obstacles
        const clearWalkPts = routeAroundObstacles(e.fromPt, e.toPt, buildings, landFeatures, 3.0);
        const walkDist = Math.max(e.distBlocks, polylineDist2D(clearWalkPts));
        const walkDur = Math.max(10, walkDist / WALK_SPEED_BLOCKS_PER_SEC);
        const lastLeg = legs[legs.length - 1];
        if (lastLeg && lastLeg.type === 'walk') {
          lastLeg.toName = e.toStopName;
          lastLeg.durationSec += walkDur;
          lastLeg.distanceBlocks += walkDist;
          lastLeg.points.push(...clearWalkPts.slice(1));
          lastLeg.instruction = `Пешком до «${e.toStopName}»`;
        } else {
          legs.push({
            type: 'walk',
            fromName: e.fromStopName,
            toName: e.toStopName,
            durationSec: walkDur,
            distanceBlocks: walkDist,
            points: clearWalkPts,
            instruction: `Пешком до «${e.toStopName}»`,
          });
        }
      }
    }

    // Recompute exact sequential local clock timestamps across every leg using real schedules
    // (because obstacle-detour walking durations may slightly alter stop arrival clock time)
    const routeById = new Map(routes.map((r) => [r.id, r]));
    let cursorClockMs = departureEpochMs;
    for (const leg of legs) {
      leg.distanceBlocks = Math.round(leg.distanceBlocks);
      if (leg.type === 'transit' && leg.routeId) {
        const rt = routeById.get(leg.routeId);
        const rideOnlySec = Math.max(10, Math.round(leg.durationSec - (leg.waitSec ?? 0)));
        if (rt) {
          const stopIdx = Math.max(
            0,
            rt.stops.findIndex((s) => s.name === leg.fromName)
          );
          const nextDep = getNextDepartureWaitSec(
            rt,
            stopIdx,
            cursorClockMs + serverClockOffsetMs,
            departuresMap?.get(rt.id)
          );
          leg.waitSec = nextDep.waitSec;
          leg.scheduledDeparture = nextDep.isScheduled;
          leg.departureTimeMs = cursorClockMs + nextDep.waitSec * 1000;
          leg.arrivalTimeMs = leg.departureTimeMs + rideOnlySec * 1000;
          leg.durationSec = nextDep.waitSec + rideOnlySec;
          cursorClockMs = leg.arrivalTimeMs;
        } else {
          const dur = Math.round(leg.durationSec);
          leg.departureTimeMs = cursorClockMs + (leg.waitSec ?? 0) * 1000;
          leg.arrivalTimeMs = cursorClockMs + dur * 1000;
          leg.durationSec = dur;
          cursorClockMs = leg.arrivalTimeMs;
        }
        if (leg.transportKind) {
          leg.instruction = `${getTransportLabelRu(leg.transportKind)} ${leg.routeNumber || ''} до ст. «${leg.toName}»`.trim();
        }
      } else {
        const dur = Math.round(leg.durationSec);
        leg.durationSec = dur;
        leg.departureTimeMs = cursorClockMs;
        leg.arrivalTimeMs = cursorClockMs + dur * 1000;
        cursorClockMs = leg.arrivalTimeMs;
      }
    }

    const totalDurationSec = Math.max(
      20,
      Math.round((cursorClockMs - departureEpochMs) / 1000)
    );
    const totalDistanceBlocks = legs.reduce((acc, l) => acc + l.distanceBlocks, 0);
    const walkingDistanceBlocks = legs
      .filter((l) => l.type === 'walk')
      .reduce((acc, l) => acc + l.distanceBlocks, 0);
    const transitLegs = legs.filter((l) => l.type === 'transit');
    const transfers = Math.max(0, transitLegs.length - 1);

    if (transitLegs.length === 0) {
      return computeStreetRoute(
        start,
        end,
        streets,
        'walk',
        'scooter',
        buildings,
        landFeatures,
        departureEpochMs
      );
    }

    const lineSummary = transitLegs
      .map((l) => `${l.transportKind === 'metro' ? 'Метро ' : ''}${l.routeNumber || l.routeName}`)
      .join(' → ');

    return {
      id: `transit-${preferMetro ? 'metro' : 'fast'}-${transitLegs.map((l) => l.routeId).join('_')}`,
      mode: 'transit',
      totalDurationSec,
      departureTimeMs: departureEpochMs,
      arrivalTimeMs: departureEpochMs + totalDurationSec * 1000,
      totalDistanceBlocks,
      walkingDistanceBlocks,
      transfers,
      legs,
      summary: lineSummary,
    };
  };

  const fastest = runSearch(false);
  if (fastest) results.push(fastest);

  const metroAlt = runSearch(true);
  if (
    metroAlt &&
    (!fastest ||
      metroAlt.summary !== fastest.summary ||
      Math.abs(metroAlt.totalDurationSec - fastest.totalDurationSec) > 25)
  ) {
    results.push(metroAlt);
  }

  return results;
}

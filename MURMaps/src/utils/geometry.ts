import type {
  Building3D,
  LandFeature,
  RoadClass,
  StreetSegment,
  WorldPoint,
  WorldPoint3D,
} from '../types/map';
import { createRectFootprint, pointToSegmentDistance } from './projection';

export const SERVER_GROUND_Y = 67;

/**
 * Strict ascending visual hierarchy for street intersection rendering
 * (0 = lowest priority pedestrian path, 5 = highest priority orange highway).
 */
export function getRoadHierarchyLevel(roadClass: RoadClass): number {
  switch (roadClass) {
    case 'pedestrian':
      return 0;
    case 'dirt':
      return 1;
    case 'service':
      return 2;
    case 'lane':
      return 3;
    case 'street':
      return 4;
    case 'embankment':
      return 5;
    case 'railway':
      return 6;
    case 'avenue':
      return 7;
    case 'highway':
      return 8;
  }
}

function segmentsIntersect2D(
  a: WorldPoint,
  b: WorldPoint,
  c: WorldPoint,
  d: WorldPoint
): WorldPoint | null {
  const rX = b.x - a.x;
  const rZ = b.z - a.z;
  const sX = d.x - c.x;
  const sZ = d.z - c.z;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-6) return null;
  const qpX = c.x - a.x;
  const qpZ = c.z - a.z;
  const t = (qpX * sZ - qpZ * sX) / denom;
  const u = (qpX * rZ - qpZ * rX) / denom;
  if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) {
    return { x: a.x + t * rX, z: a.z + t * rZ };
  }
  return null;
}

/**
 * Eliminates vortices, micro-loops, and sharp backtracking hairpins caused by stop-to-road
 * snapping or noisy road nodes while preserving intentional wide turns and termini.
 */
export function removePathVortices2D(
  points: WorldPoint[],
  options: { minPointGap?: number; maxSpikeLen?: number; maxLoopSpan?: number } = {}
): WorldPoint[] {
  if (points.length <= 2) return points;
  const minGap = options.minPointGap ?? 2.5;
  const maxSpikeLen = options.maxSpikeLen ?? 85;
  const maxLoopSpan = options.maxLoopSpan ?? 180;

  // 1. Deduplicate near-coincident consecutive vertices
  let pts: WorldPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].z - prev.z) >= minGap) {
      pts.push(points[i]);
    }
  }
  if (pts.length === 1 && points.length > 1) {
    pts.push(points[points.length - 1]);
  }
  if (pts.length <= 2) return pts;

  // 2. Uncross small local self-intersecting vortices (e.g. tight knots near stops/intersections)
  let changed = true;
  let guard = 0;
  while (changed && guard < 6 && pts.length > 3) {
    changed = false;
    guard++;

    // 2a. Remove small self-crossing loops
    outerLoop: for (let i = 0; i < pts.length - 3; i++) {
      const maxJ = Math.min(pts.length - 2, i + 6);
      for (let j = i + 2; j <= maxJ; j++) {
        const hit = segmentsIntersect2D(pts[i], pts[i + 1], pts[j], pts[j + 1]);
        if (hit) {
          let loopLen = 0;
          for (let k = i + 1; k < j; k++) {
            loopLen += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z);
          }
          if (loopLen <= maxLoopSpan) {
            pts = [...pts.slice(0, i + 1), hit, ...pts.slice(j + 1)];
            changed = true;
            break outerLoop;
          }
        }
      }
    }

    // 2b. Remove sharp backtracking spikes / hairpin zigzags (dot < -0.45 on short legs)
    if (pts.length > 2) {
      const cleaned: WorldPoint[] = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const prev = cleaned[cleaned.length - 1];
        const curr = pts[i];
        const next = pts[i + 1];
        const ax = curr.x - prev.x;
        const az = curr.z - prev.z;
        const bx = next.x - curr.x;
        const bz = next.z - curr.z;
        const la = Math.hypot(ax, az);
        const lb = Math.hypot(bx, bz);
        if (la < 1.5 || lb < 1.5) {
          changed = true;
          continue;
        }
        const dot = (ax * bx + az * bz) / (la * lb);
        const direct = Math.hypot(next.x - prev.x, next.z - prev.z);
        // Backtracking hairpin spike: reverses direction over a short leg
        if (
          (dot < -0.45 && Math.min(la, lb) <= maxSpikeLen) ||
          (dot < -0.78 && Math.min(la, lb) <= maxSpikeLen * 1.6 && direct < (la + lb) * 0.55)
        ) {
          changed = true;
          continue;
        }
        cleaned.push(curr);
      }
      cleaned.push(pts[pts.length - 1]);
      pts = cleaned;
    }
  }

  return pts;
}

/**
 * 3D counterpart of `removePathVortices2D` preserving accurate elevation Y across cleaned nodes.
 */
export function removePathVortices3D(
  points: WorldPoint3D[],
  options: { minPointGap?: number; maxSpikeLen?: number; maxLoopSpan?: number } = {}
): WorldPoint3D[] {
  if (points.length <= 2) return points;
  const minGap = options.minPointGap ?? 2.0;
  const maxSpikeLen = options.maxSpikeLen ?? 85;
  const maxLoopSpan = options.maxLoopSpan ?? 180;

  let pts: WorldPoint3D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = pts[pts.length - 1];
    if (
      Math.hypot(points[i].x - prev.x, points[i].z - prev.z) >= minGap ||
      Math.abs(points[i].y - prev.y) >= 2.5
    ) {
      pts.push(points[i]);
    }
  }
  if (pts.length === 1 && points.length > 1) {
    pts.push(points[points.length - 1]);
  }
  if (pts.length <= 2) return pts;

  let changed = true;
  let guard = 0;
  while (changed && guard < 6 && pts.length > 3) {
    changed = false;
    guard++;

    outerLoop: for (let i = 0; i < pts.length - 3; i++) {
      const maxJ = Math.min(pts.length - 2, i + 6);
      for (let j = i + 2; j <= maxJ; j++) {
        const hit = segmentsIntersect2D(pts[i], pts[i + 1], pts[j], pts[j + 1]);
        if (hit) {
          let loopLen = 0;
          for (let k = i + 1; k < j; k++) {
            loopLen += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z);
          }
          // Only collapse same-level planar vortices (never collapse genuine multi-level overpasses!)
          const dySpan = Math.abs(pts[i].y - pts[j].y);
          if (loopLen <= maxLoopSpan && dySpan <= 5) {
            const avgY = (pts[i].y + pts[i + 1].y + pts[j].y + pts[j + 1].y) * 0.25;
            pts = [...pts.slice(0, i + 1), { x: hit.x, y: avgY, z: hit.z }, ...pts.slice(j + 1)];
            changed = true;
            break outerLoop;
          }
        }
      }
    }

    if (pts.length > 2) {
      const cleaned: WorldPoint3D[] = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const prev = cleaned[cleaned.length - 1];
        const curr = pts[i];
        const next = pts[i + 1];
        const ax = curr.x - prev.x;
        const az = curr.z - prev.z;
        const bx = next.x - curr.x;
        const bz = next.z - curr.z;
        const la = Math.hypot(ax, az);
        const lb = Math.hypot(bx, bz);
        if (la < 1.2 || lb < 1.2) {
          changed = true;
          continue;
        }
        const dot = (ax * bx + az * bz) / (la * lb);
        const direct = Math.hypot(next.x - prev.x, next.z - prev.z);
        if (
          (dot < -0.45 && Math.min(la, lb) <= maxSpikeLen) ||
          (dot < -0.78 && Math.min(la, lb) <= maxSpikeLen * 1.6 && direct < (la + lb) * 0.55)
        ) {
          changed = true;
          continue;
        }
        cleaned.push(curr);
      }
      cleaned.push(pts[pts.length - 1]);
      pts = cleaned;
    }
  }

  return pts;
}

/**
 * Replaces polyline corners with true constant-curvature circular arcs (inscribed tangent arcs)
 * after stripping micro-vortices, so roads, railways, and transit lines have smooth constant
 * curvature through every bend without wobbles or overshoots.
 */
export function smoothStreetPolyline(
  points: WorldPoint[],
  cornerRadiusBlocks = 22,
  stepsPerCorner = 6
): WorldPoint[] {
  const clean = removePathVortices2D(points, { minPointGap: 2 });
  if (clean.length <= 2) return clean;

  const out: WorldPoint[] = [clean[0]];

  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1];
    const curr = clean[i];
    const next = clean[i + 1];

    const v1x = prev.x - curr.x;
    const v1z = prev.z - curr.z;
    const v2x = next.x - curr.x;
    const v2z = next.z - curr.z;
    const len1 = Math.hypot(v1x, v1z);
    const len2 = Math.hypot(v2x, v2z);

    if (len1 < 3 || len2 < 3) {
      out.push(curr);
      continue;
    }

    const u1x = v1x / len1;
    const u1z = v1z / len1;
    const u2x = v2x / len2;
    const u2z = v2z / len2;

    const dot = Math.max(-1, Math.min(1, u1x * u2x + u1z * u2z));
    // Skip nearly straight joints (<= ~4 deg deflection)
    if (dot < -0.997) {
      out.push(curr);
      continue;
    }
    // Avoid degenerate 0-deg fold
    if (dot > 0.985) {
      continue;
    }

    // Angle between incoming and outgoing rays from corner (0..pi)
    const theta = Math.acos(dot);
    const halfTheta = theta * 0.5;
    const tanHalf = Math.tan(halfTheta);
    if (tanHalf < 1e-4) {
      out.push(curr);
      continue;
    }

    // Distance along each leg from corner to tangent point, capped so adjacent arcs never overlap
    const maxTangentDist = Math.min(len1 * 0.44, len2 * 0.44);
    const desiredTangentDist = cornerRadiusBlocks / tanHalf;
    const tangentDist = Math.min(maxTangentDist, desiredTangentDist);
    const arcRadius = tangentDist * tanHalf;

    if (tangentDist < 1.2 || arcRadius < 1.0) {
      out.push(curr);
      continue;
    }

    const pStartX = curr.x + u1x * tangentDist;
    const pStartZ = curr.z + u1z * tangentDist;
    const pEndX = curr.x + u2x * tangentDist;
    const pEndZ = curr.z + u2z * tangentDist;

    // Center of inscribed circle lies along angle bisector at distance arcRadius / sin(halfTheta)
    const bisX = u1x + u2x;
    const bisZ = u1z + u2z;
    const bisLen = Math.hypot(bisX, bisZ);
    if (bisLen < 1e-5) {
      out.push(curr);
      continue;
    }
    const centerDist = arcRadius / Math.sin(halfTheta);
    const cx = curr.x + (bisX / bisLen) * centerDist;
    const cz = curr.z + (bisZ / bisLen) * centerDist;

    const aStart = Math.atan2(pStartZ - cz, pStartX - cx);
    const aEnd = Math.atan2(pEndZ - cz, pEndX - cx);
    let dAngle = aEnd - aStart;
    while (dAngle > Math.PI) dAngle -= Math.PI * 2;
    while (dAngle < -Math.PI) dAngle += Math.PI * 2;

    const arcSteps = Math.max(3, Math.min(12, Math.ceil((Math.abs(dAngle) / (Math.PI * 0.5)) * stepsPerCorner)));
    for (let s = 0; s <= arcSteps; s++) {
      const a = aStart + (dAngle * s) / arcSteps;
      const px = cx + Math.cos(a) * arcRadius;
      const pz = cz + Math.sin(a) * arcRadius;
      const last = out[out.length - 1];
      if (!last || Math.hypot(px - last.x, pz - last.z) >= 0.75) {
        out.push({
          x: Math.round(px * 10) / 10,
          z: Math.round(pz * 10) / 10,
        });
      }
    }
  }

  const finalPt = clean[clean.length - 1];
  const lastOut = out[out.length - 1];
  if (!lastOut || Math.hypot(finalPt.x - lastOut.x, finalPt.z - lastOut.z) >= 0.5) {
    out.push(finalPt);
  }
  return out;
}

/**
 * Smooths a 3D transit/rail path with vortex removal + constant-curvature circular-arc bends
 * for polygonal routes and centripetal Catmull-Rom refinement for smoothly sampled tracks,
 * guaranteeing uniform curvature without vortices, cusps, or overshoots.
 */
export function smoothMagic3DPath(
  points: WorldPoint3D[],
  subdivisionsPerSegment = 4
): WorldPoint3D[] {
  const clean = removePathVortices3D(points, { minPointGap: 1.5 });
  if (clean.length <= 2) return clean;

  // Pass 1: Replace sharp polygonal turns with true constant-curvature circular arcs in (x, z)
  // while interpolating elevation Y smoothly across each arc.
  const arcSmoothed: WorldPoint3D[] = [clean[0]];
  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1];
    const curr = clean[i];
    const next = clean[i + 1];

    const v1x = prev.x - curr.x;
    const v1z = prev.z - curr.z;
    const v2x = next.x - curr.x;
    const v2z = next.z - curr.z;
    const len1 = Math.hypot(v1x, v1z);
    const len2 = Math.hypot(v2x, v2z);

    if (len1 < 3 || len2 < 3) {
      arcSmoothed.push(curr);
      continue;
    }

    const u1x = v1x / len1;
    const u1z = v1z / len1;
    const u2x = v2x / len2;
    const u2z = v2z / len2;
    const dot = Math.max(-1, Math.min(1, u1x * u2x + u1z * u2z));

    // Only apply circular-arc corner replacement on notable corners (> ~14 deg deflection)
    // and preserve gentle curved tracks for centripetal spline pass below
    if (dot < -0.97 || dot > 0.985) {
      arcSmoothed.push(curr);
      continue;
    }

    const theta = Math.acos(dot);
    const halfTheta = theta * 0.5;
    const tanHalf = Math.tan(halfTheta);
    const maxTangentDist = Math.min(len1 * 0.42, len2 * 0.42);
    const desiredRadius = Math.min(48, Math.max(18, Math.min(len1, len2) * 0.35));
    const tangentDist = Math.min(maxTangentDist, desiredRadius / Math.max(1e-4, tanHalf));
    const arcRadius = tangentDist * tanHalf;

    const bisX = u1x + u2x;
    const bisZ = u1z + u2z;
    const bisLen = Math.hypot(bisX, bisZ);
    if (tangentDist < 2 || arcRadius < 1.5 || bisLen < 1e-5) {
      arcSmoothed.push(curr);
      continue;
    }

    const pStartX = curr.x + u1x * tangentDist;
    const pStartZ = curr.z + u1z * tangentDist;
    const pEndX = curr.x + u2x * tangentDist;
    const pEndZ = curr.z + u2z * tangentDist;

    const yStart = curr.y + (prev.y - curr.y) * (tangentDist / len1);
    const yEnd = curr.y + (next.y - curr.y) * (tangentDist / len2);

    const centerDist = arcRadius / Math.sin(halfTheta);
    const cx = curr.x + (bisX / bisLen) * centerDist;
    const cz = curr.z + (bisZ / bisLen) * centerDist;

    const aStart = Math.atan2(pStartZ - cz, pStartX - cx);
    const aEnd = Math.atan2(pEndZ - cz, pEndX - cx);
    let dAngle = aEnd - aStart;
    while (dAngle > Math.PI) dAngle -= Math.PI * 2;
    while (dAngle < -Math.PI) dAngle += Math.PI * 2;

    const arcSteps = Math.max(
      3,
      Math.min(10, Math.ceil((Math.abs(dAngle) / (Math.PI * 0.5)) * Math.max(4, subdivisionsPerSegment + 1)))
    );
    for (let s = 0; s <= arcSteps; s++) {
      const frac = s / arcSteps;
      const a = aStart + dAngle * frac;
      const px = cx + Math.cos(a) * arcRadius;
      const pz = cz + Math.sin(a) * arcRadius;
      const py = yStart + (yEnd - yStart) * frac;
      const last = arcSmoothed[arcSmoothed.length - 1];
      if (!last || Math.hypot(px - last.x, pz - last.z) >= 1.0) {
        arcSmoothed.push({
          x: Math.round(px * 10) / 10,
          y: Math.round(py * 10) / 10,
          z: Math.round(pz * 10) / 10,
        });
      }
    }
  }
  const endPt = clean[clean.length - 1];
  const lastArc = arcSmoothed[arcSmoothed.length - 1];
  if (!lastArc || Math.hypot(endPt.x - lastArc.x, endPt.z - lastArc.z) >= 0.5) {
    arcSmoothed.push(endPt);
  }

  // Pass 2: Gentle centripetal Catmull-Rom interpolation across long spans so elevation & broad sweeps stay silky smooth
  const n = arcSmoothed.length;
  if (n <= 2) return arcSmoothed;

  const out: WorldPoint3D[] = [];
  const knotStep = (a: WorldPoint3D, b: WorldPoint3D): number => {
    const d = Math.hypot(b.x - a.x, b.z - a.z, (b.y - a.y) * 0.5);
    return Math.max(0.01, Math.pow(d, 0.5));
  };

  const evalCentripetal = (
    p0: WorldPoint3D,
    p1: WorldPoint3D,
    p2: WorldPoint3D,
    p3: WorldPoint3D,
    u: number
  ): WorldPoint3D => {
    const t0 = 0;
    const t1 = t0 + knotStep(p0, p1);
    const t2 = t1 + knotStep(p1, p2);
    const t3 = t2 + knotStep(p2, p3);
    const t = t1 + (t2 - t1) * u;

    const lerpPt = (
      a: WorldPoint3D,
      b: WorldPoint3D,
      ta: number,
      tb: number
    ): WorldPoint3D => {
      const denom = tb - ta;
      if (Math.abs(denom) < 1e-6) return a;
      const w1 = (tb - t) / denom;
      const w2 = (t - ta) / denom;
      return {
        x: w1 * a.x + w2 * b.x,
        y: w1 * a.y + w2 * b.y,
        z: w1 * a.z + w2 * b.z,
      };
    };

    const a1 = lerpPt(p0, p1, t0, t1);
    const a2 = lerpPt(p1, p2, t1, t2);
    const a3 = lerpPt(p2, p3, t2, t3);
    const b1 = lerpPt(a1, a2, t0, t2);
    const b2 = lerpPt(a2, a3, t1, t3);
    return lerpPt(b1, b2, t1, t2);
  };

  for (let i = 0; i < n - 1; i++) {
    const p1 = arcSmoothed[i];
    const p2 = arcSmoothed[i + 1];
    const p0: WorldPoint3D =
      i > 0
        ? arcSmoothed[i - 1]
        : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, z: 2 * p1.z - p2.z };
    const p3: WorldPoint3D =
      i + 2 < n
        ? arcSmoothed[i + 2]
        : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, z: 2 * p2.z - p1.z };

    const segDist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = segDist < 18 ? 1 : Math.min(subdivisionsPerSegment, Math.ceil(segDist / 24));

    for (let s = 0; s < steps; s++) {
      out.push(evalCentripetal(p0, p1, p2, p3, s / steps));
    }
  }
  out.push(arcSmoothed[n - 1]);
  return out;
}

/**
 * Builds a tangent-continuous 3D cubic Bezier turnaround loop / depot connector
 * from the end of `pathFrom` smoothly into the start of `pathTo`.
 * Returns intermediate points + final endpoint `pathTo[0]` (excluding `pathFrom[last]`).
 */
export function buildTurnaroundConnector3D(
  pathFrom: WorldPoint3D[],
  pathTo: WorldPoint3D[]
): WorldPoint3D[] {
  if (pathFrom.length < 2 || pathTo.length < 2) return [];

  const p0 = pathFrom[pathFrom.length - 1];
  const p3 = pathTo[0];
  const chordDx = p3.x - p0.x;
  const chordDz = p3.z - p0.z;
  const dist = Math.hypot(chordDx, chordDz);
  if (dist <= 4) return [];

  let prevA = pathFrom[pathFrom.length - 2];
  for (let i = pathFrom.length - 2; i >= 0; i--) {
    if (Math.hypot(p0.x - pathFrom[i].x, p0.z - pathFrom[i].z) >= 18) {
      prevA = pathFrom[i];
      break;
    }
  }
  let t0x = p0.x - prevA.x;
  let t0z = p0.z - prevA.z;
  const t0Len = Math.hypot(t0x, t0z);
  if (t0Len > 0.5) {
    t0x /= t0Len;
    t0z /= t0Len;
  } else {
    t0x = chordDx / dist;
    t0z = chordDz / dist;
  }

  let nextB = pathTo[1];
  for (let i = 1; i < pathTo.length; i++) {
    if (Math.hypot(pathTo[i].x - p3.x, pathTo[i].z - p3.z) >= 18) {
      nextB = pathTo[i];
      break;
    }
  }
  let t3x = nextB.x - p3.x;
  let t3z = nextB.z - p3.z;
  const t3Len = Math.hypot(t3x, t3z);
  if (t3Len > 0.5) {
    t3x /= t3Len;
    t3z /= t3Len;
  } else {
    t3x = chordDx / dist;
    t3z = chordDz / dist;
  }

  const handle = Math.min(Math.max(12, dist * 0.36), 82);
  const p1x = p0.x + t0x * handle;
  const p1z = p0.z + t0z * handle;
  const p2x = p3.x - t3x * handle;
  const p2z = p3.z - t3z * handle;

  const steps = Math.max(5, Math.min(16, Math.ceil(dist / 16)));
  const out: WorldPoint3D[] = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const omt = 1 - t;
    const omt2 = omt * omt;
    const t2 = t * t;
    const x =
      omt2 * omt * p0.x +
      3 * omt2 * t * p1x +
      3 * omt * t2 * p2x +
      t2 * t * p3.x;
    const z =
      omt2 * omt * p0.z +
      3 * omt2 * t * p1z +
      3 * omt * t2 * p2z +
      t2 * t * p3.z;
    const y = p0.y + (p3.y - p0.y) * t;
    out.push({
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      z: Math.round(z * 10) / 10,
    });
  }
  return out;
}

export interface RoadSnapResult {
  x: number;
  z: number;
  y: number;
  targetElevationY?: number;
  snapped: boolean;
  snapKind: 'vertex' | 'edge' | 'none';
  targetStreetId?: string;
  targetStreetName?: string;
}

/**
 * Snaps a cursor point onto the existing road / railway network (vertices first, then
 * orthogonal projection onto any segment at arbitrary angle/slope without axis-locking).
 */
export function snapRoadPointToNetwork(
  pt: WorldPoint,
  streets: StreetSegment[],
  currentElevationY: number = SERVER_GROUND_Y,
  maxSnapDist = 18
): RoadSnapResult {
  let bestVertexDist = maxSnapDist;
  let bestVertex: RoadSnapResult | null = null;

  let bestEdgeDist = maxSnapDist;
  let bestEdge: RoadSnapResult | null = null;

  for (const st of streets) {
    if (st.points.length < 2) continue;
    const pts3D =
      st.points3D && st.points3D.length === st.points.length
        ? st.points3D
        : st.points.map((p) => ({ x: p.x, y: st.elevationY ?? SERVER_GROUND_Y, z: p.z }));

    // 1. Check vertices (highest priority for clean junctions)
    for (let i = 0; i < pts3D.length; i++) {
      const v = pts3D[i];
      const d = Math.hypot(pt.x - v.x, pt.z - v.z);
      if (d < bestVertexDist) {
        bestVertexDist = d;
        bestVertex = {
          x: Math.round(v.x * 10) / 10,
          z: Math.round(v.z * 10) / 10,
          y: currentElevationY,
          targetElevationY: v.y,
          snapped: true,
          snapKind: 'vertex',
          targetStreetId: st.id,
          targetStreetName: st.name,
        };
      }
    }

    // 2. Check orthogonal projection onto any segment (arbitrary angles & slopes!)
    for (let i = 0; i < pts3D.length - 1; i++) {
      const a = pts3D[i];
      const b = pts3D[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 1e-4) continue;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / lenSq));
      const px = a.x + t * dx;
      const pz = a.z + t * dz;
      const d = Math.hypot(pt.x - px, pt.z - pz);
      if (d < bestEdgeDist) {
        bestEdgeDist = d;
        const py = Math.round((a.y + t * (b.y - a.y)) * 10) / 10;
        bestEdge = {
          x: Math.round(px * 10) / 10,
          z: Math.round(pz * 10) / 10,
          y: currentElevationY,
          targetElevationY: py,
          snapped: true,
          snapKind: 'edge',
          targetStreetId: st.id,
          targetStreetName: st.name,
        };
      }
    }
  }

  if (bestVertex) return bestVertex;
  if (bestEdge) return bestEdge;

  return {
    x: Math.round(pt.x * 10) / 10,
    z: Math.round(pt.z * 10) / 10,
    y: currentElevationY,
    snapped: false,
    snapKind: 'none',
  };
}

function getStreetPoints3D(street: StreetSegment): WorldPoint3D[] {
  if (street.points3D && street.points3D.length === street.points.length) {
    return street.points3D.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  }
  const y = street.elevationY ?? SERVER_GROUND_Y;
  return street.points.map((p) => ({ x: p.x, y, z: p.z }));
}

function insertIntersectionNodesIntoPolyline(
  pts: WorldPoint3D[],
  insertionsBySeg: Map<number, Array<{ t: number; pt: WorldPoint3D }>>
): WorldPoint3D[] {
  if (insertionsBySeg.size === 0) return pts;
  const out: WorldPoint3D[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const list = insertionsBySeg.get(i);
    if (list && list.length > 0) {
      list.sort((a, b) => a.t - b.t);
      for (const item of list) {
        const last = out[out.length - 1];
        if (Math.hypot(item.pt.x - last.x, item.pt.z - last.z) >= 1.5) {
          out.push(item.pt);
        }
      }
    }
    const end = pts[i + 1];
    const last = out[out.length - 1];
    if (Math.hypot(end.x - last.x, end.z - last.z) >= 0.8) {
      out.push(end);
    }
  }
  return out;
}

/**
 * Automatically detects crossings and T-junctions between `newStreet` and `existingStreets`
 * at compatible elevations (`|Δy| <= maxElevDiff`), inserting shared intersection nodes into
 * BOTH polylines so roads & railways form real topological intersections automatically.
 */
export function integrateStreetWithAutoIntersections(
  newStreet: StreetSegment,
  existingStreets: StreetSegment[],
  options: { junctionTol?: number; maxElevDiff?: number } = {}
): {
  street: StreetSegment;
  updatedExistingStreets: StreetSegment[];
  intersections: WorldPoint[];
} {
  const junctionTol = options.junctionTol ?? 4.5;
  const maxElevDiff = options.maxElevDiff ?? 4;

  const newPts = getStreetPoints3D(newStreet);
  if (newPts.length < 2) {
    return { street: newStreet, updatedExistingStreets: [], intersections: [] };
  }

  const newInsertions = new Map<number, Array<{ t: number; pt: WorldPoint3D }>>();
  const updatedExistingStreets: StreetSegment[] = [];
  const intersections: WorldPoint[] = [];

  const pushUniqueIntersection = (x: number, z: number) => {
    if (!intersections.some((p) => Math.hypot(p.x - x, p.z - z) < 2.5)) {
      intersections.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
    }
  };

  for (const ex of existingStreets) {
    if (ex.id === newStreet.id || ex.points.length < 2) continue;
    const exPts = getStreetPoints3D(ex);
    const exInsertions = new Map<number, Array<{ t: number; pt: WorldPoint3D }>>();
    let exModified = false;

    for (let i = 0; i < newPts.length - 1; i++) {
      const a = newPts[i];
      const b = newPts[i + 1];
      const abX = b.x - a.x;
      const abZ = b.z - a.z;
      const abLenSq = abX * abX + abZ * abZ;
      if (abLenSq < 1e-4) continue;

      for (let j = 0; j < exPts.length - 1; j++) {
        const c = exPts[j];
        const d = exPts[j + 1];
        const cdX = d.x - c.x;
        const cdZ = d.z - c.z;
        const cdLenSq = cdX * cdX + cdZ * cdZ;
        if (cdLenSq < 1e-4) continue;

        // 1. Check strict interior X-crossing
        const denom = abX * cdZ - abZ * cdX;
        if (Math.abs(denom) > 1e-5) {
          const qpX = c.x - a.x;
          const qpZ = c.z - a.z;
          const t = (qpX * cdZ - qpZ * cdX) / denom;
          const u = (qpX * abZ - qpZ * abX) / denom;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            const ix = Math.round((a.x + t * abX) * 10) / 10;
            const iz = Math.round((a.z + t * abZ) * 10) / 10;
            const yNew = a.y + t * (b.y - a.y);
            const yEx = c.y + u * (d.y - c.y);
            if (Math.abs(yNew - yEx) <= maxElevDiff) {
              const avgY = Math.round(((yNew + yEx) * 0.5) * 10) / 10;
              const node: WorldPoint3D = { x: ix, y: avgY, z: iz };
              if (t > 0.02 && t < 0.98) {
                const arr = newInsertions.get(i) ?? [];
                arr.push({ t, pt: node });
                newInsertions.set(i, arr);
              }
              if (u > 0.02 && u < 0.98) {
                const arr = exInsertions.get(j) ?? [];
                arr.push({ t: u, pt: node });
                exInsertions.set(j, arr);
                exModified = true;
              }
              pushUniqueIntersection(ix, iz);
              continue;
            }
          }
        }

        // 2. Check T-junctions: endpoints of newStreet touching interior of existing segment
        for (const endIdx of [i, i + 1]) {
          const ep = newPts[endIdx];
          const u = Math.max(0, Math.min(1, ((ep.x - c.x) * cdX + (ep.z - c.z) * cdZ) / cdLenSq));
          const px = c.x + u * cdX;
          const pz = c.z + u * cdZ;
          const dist = Math.hypot(ep.x - px, ep.z - pz);
          if (dist <= junctionTol) {
            const yEx = c.y + u * (d.y - c.y);
            if (Math.abs(ep.y - yEx) <= maxElevDiff) {
              const ix = Math.round(px * 10) / 10;
              const iz = Math.round(pz * 10) / 10;
              const avgY = Math.round(((ep.y + yEx) * 0.5) * 10) / 10;
              // Snap endpoint slightly to exact centerline for gap-free junction
              ep.x = ix;
              ep.z = iz;
              if (u > 0.02 && u < 0.98) {
                const arr = exInsertions.get(j) ?? [];
                arr.push({ t: u, pt: { x: ix, y: avgY, z: iz } });
                exInsertions.set(j, arr);
                exModified = true;
              }
              pushUniqueIntersection(ix, iz);
            }
          }
        }

        // 3. Check reverse T-junctions: endpoints of existing segment touching interior of newStreet
        for (const exEndIdx of [j, j + 1]) {
          const ep = exPts[exEndIdx];
          const t = Math.max(0, Math.min(1, ((ep.x - a.x) * abX + (ep.z - a.z) * abZ) / abLenSq));
          const px = a.x + t * abX;
          const pz = a.z + t * abZ;
          const dist = Math.hypot(ep.x - px, ep.z - pz);
          if (dist <= junctionTol) {
            const yNew = a.y + t * (b.y - a.y);
            if (Math.abs(ep.y - yNew) <= maxElevDiff) {
              const ix = Math.round(px * 10) / 10;
              const iz = Math.round(pz * 10) / 10;
              const avgY = Math.round(((ep.y + yNew) * 0.5) * 10) / 10;
              if (t > 0.02 && t < 0.98) {
                const arr = newInsertions.get(i) ?? [];
                arr.push({ t, pt: { x: ix, y: avgY, z: iz } });
                newInsertions.set(i, arr);
              }
              pushUniqueIntersection(ix, iz);
            }
          }
        }
      }
    }

    if (exModified) {
      const mergedExPts3D = insertIntersectionNodesIntoPolyline(exPts, exInsertions);
      const has3D =
        Boolean(ex.points3D) ||
        mergedExPts3D.some((p) => Math.abs(p.y - (ex.elevationY ?? SERVER_GROUND_Y)) > 0.2);
      updatedExistingStreets.push({
        ...ex,
        points: mergedExPts3D.map((p) => ({ x: p.x, z: p.z })),
        points3D: has3D ? mergedExPts3D : undefined,
        isUserEdited: true,
      });
    }
  }

  const mergedNewPts3D = insertIntersectionNodesIntoPolyline(newPts, newInsertions);
  const hasNew3D =
    Boolean(newStreet.points3D) ||
    mergedNewPts3D.some((p) => Math.abs(p.y - (newStreet.elevationY ?? SERVER_GROUND_Y)) > 0.2);

  const avgY =
    mergedNewPts3D.reduce((sum, p) => sum + p.y, 0) / Math.max(1, mergedNewPts3D.length);

  return {
    street: {
      ...newStreet,
      elevationY: Math.round(avgY * 10) / 10,
      points: mergedNewPts3D.map((p) => ({ x: p.x, z: p.z })),
      points3D: hasNew3D ? mergedNewPts3D : undefined,
    },
    updatedExistingStreets,
    intersections,
  };
}

export interface RoadSnappedBuildingRect {
  x: number;
  z: number;
  width: number;
  depth: number;
  angleDeg: number;
  footprint: WorldPoint[];
  snapped: boolean;
  snappedStreetId?: string;
  snappedStreetName?: string;
  snappedDistrict?: string;
  snappedToBuildingId?: string;
  snappedEdge?: [WorldPoint, WorldPoint];
}

/**
 * Snaps a candidate building/wing rectangle strictly flush (0.0 blocks gap) against the
 * closest edge of any neighboring building or wing within `snapTolerance`, optionally aligning
 * its angle & end-corners so multi-part buildings have zero seams or gaps.
 */
export function snapBuildingRectToNeighbors(
  rect: RoadSnappedBuildingRect,
  existingBuildings: Building3D[],
  excludeBuildingId?: string,
  snapTolerance = 10
): RoadSnappedBuildingRect {
  if (!existingBuildings || existingBuildings.length === 0) return rect;

  let bestGap = snapTolerance + 0.001;
  let bestResult: RoadSnappedBuildingRect | null = null;

  const candMaxHalf = Math.hypot(rect.width, rect.depth) * 0.5;

  for (const b of existingBuildings) {
    if (excludeBuildingId && b.id === excludeBuildingId) continue;
    const wings =
      b.wings && b.wings.length > 0
        ? b.wings
        : [{ id: b.id, x: b.x, z: b.z, footprint: b.footprint, orientationDeg: b.orientationDeg }];

    for (const w of wings) {
      const fp = w.footprint;
      if (!fp || fp.length < 4) continue;
      // Quick spatial cull
      const distCenters = Math.hypot(rect.x - w.x, rect.z - w.z);
      const nbRadius = Math.max(
        Math.hypot(fp[1].x - fp[0].x, fp[1].z - fp[0].z),
        Math.hypot(fp[2].x - fp[1].x, fp[2].z - fp[1].z)
      );
      if (distCenters > candMaxHalf + nbRadius + snapTolerance * 3) continue;

      // Test each of the 4 edges of the neighbor wing
      const edgeCount = fp.length === 4 ? 4 : Math.min(fp.length, 8);
      for (let eIdx = 0; eIdx < edgeCount; eIdx++) {
        const a = fp[eIdx];
        const c = fp[(eIdx + 1) % fp.length];
        const edx = c.x - a.x;
        const edz = c.z - a.z;
        const edgeLen = Math.hypot(edx, edz);
        if (edgeLen < 1) continue;

        // Edge tangent (tx, tz) and outward normal (nx, nz)
        const tx = edx / edgeLen;
        const tz = edz / edgeLen;
        let nx = -tz;
        let nz = tx;
        // Orient normal to point outward from neighbor center (w.x, w.z)
        const midX = (a.x + c.x) * 0.5;
        const midZ = (a.z + c.z) * 0.5;
        if ((midX - w.x) * nx + (midZ - w.z) * nz < 0) {
          nx = -nx;
          nz = -nz;
        }

        // Compute candidate angle aligned with this neighbor edge
        let edgeAngleDeg = Math.round(((Math.atan2(tz, tx) * 180) / Math.PI) * 10) / 10;
        if (edgeAngleDeg > 90) edgeAngleDeg -= 180;
        if (edgeAngleDeg < -90) edgeAngleDeg += 180;

        // Check angular proximity: adopt edge angle if within 28° (or orthogonal 90° ± 28°)
        const diffMod90 = Math.abs((((rect.angleDeg - edgeAngleDeg) % 90) + 135) % 90 - 45);
        const angleDist = Math.abs(45 - diffMod90); // 0° when parallel or perpendicular
        if (rect.snapped && angleDist > 26) continue;

        // Determine which candidate dimension (width vs depth) sits perpendicular to the neighbor edge
        const radCand = (rect.angleDeg * Math.PI) / 180;
        const candUx = Math.cos(radCand);
        const candUz = Math.sin(radCand);
        const parallelDot = Math.abs(candUx * tx + candUz * tz);
        const useWidthAlongEdge = parallelDot >= 0.707;
        const spanAlongEdge = useWidthAlongEdge ? rect.width : rect.depth;
        const spanPerpEdge = useWidthAlongEdge ? rect.depth : rect.width;

        // Project candidate center onto edge tangent & outward normal
        const relX = rect.x - a.x;
        const relZ = rect.z - a.z;
        const projT = relX * tx + relZ * tz;
        const projN = relX * nx + relZ * nz;

        // Candidate must be on the exterior side of the edge and overlap its longitudinal span
        if (projN < 0) continue;
        const minOverlapT = -spanAlongEdge * 0.5 - snapTolerance;
        const maxOverlapT = edgeLen + spanAlongEdge * 0.5 + snapTolerance;
        if (projT < minOverlapT || projT > maxOverlapT) continue;

        // Current gap between candidate's inner wall and the neighbor's outer wall
        const gap = Math.abs(projN - spanPerpEdge * 0.5);
        if (gap < bestGap) {
          bestGap = gap;

          // Optional flush corner-to-corner alignment along the edge tangent!
          let snappedT = projT;
          const candStartT = projT - spanAlongEdge * 0.5;
          const candEndT = projT + spanAlongEdge * 0.5;
          if (Math.abs(candStartT - 0) <= snapTolerance) {
            snappedT = spanAlongEdge * 0.5;
          } else if (Math.abs(candEndT - edgeLen) <= snapTolerance) {
            snappedT = edgeLen - spanAlongEdge * 0.5;
          } else if (Math.abs(candEndT - 0) <= snapTolerance) {
            snappedT = -spanAlongEdge * 0.5;
          } else if (Math.abs(candStartT - edgeLen) <= snapTolerance) {
            snappedT = edgeLen + spanAlongEdge * 0.5;
          }

          // Exact 0.0-gap contact center
          const exactN = spanPerpEdge * 0.5;
          const finalCx = Math.round((a.x + tx * snappedT + nx * exactN) * 100) / 100;
          const finalCz = Math.round((a.z + tz * snappedT + nz * exactN) * 100) / 100;

          const outW = spanAlongEdge;
          const outD = spanPerpEdge;

          bestResult = {
            ...rect,
            x: finalCx,
            z: finalCz,
            width: outW,
            depth: outD,
            angleDeg: edgeAngleDeg,
            footprint: createRectFootprint(finalCx, finalCz, outW, outD, edgeAngleDeg),
            snapped: true,
            snappedToBuildingId: b.id,
            snappedEdge: [
              { x: a.x, z: a.z },
              { x: c.x, z: c.z },
            ],
            snappedStreetName: rect.snappedStreetName ?? b.street,
            snappedDistrict: rect.snappedDistrict ?? b.district,
          };
        }
      }
    }
  }

  return bestResult ?? rect;
}

export interface BuildingPointSnapResult {
  x: number;
  z: number;
  snapped: boolean;
  snapKind: 'vertex' | 'edge' | 'none';
  targetBuildingId?: string;
  snapGuide?: [WorldPoint, WorldPoint];
}

/**
 * Snaps an arbitrary world point (e.g. a freeform polygon vertex being placed or dragged)
 * to the nearest vertex (highest priority) or edge of any existing building footprint.
 */
export function snapPointToBuildings(
  pt: WorldPoint,
  buildings: Building3D[],
  excludeBuildingId?: string,
  excludeWingId?: string,
  tolerance = 8
): BuildingPointSnapResult {
  if (!buildings || buildings.length === 0 || tolerance <= 0) {
    return {
      x: Math.round(pt.x * 10) / 10,
      z: Math.round(pt.z * 10) / 10,
      snapped: false,
      snapKind: 'none',
    };
  }

  let bestVertexDist = tolerance;
  let bestVertex: BuildingPointSnapResult | null = null;
  let bestEdgeDist = tolerance;
  let bestEdge: BuildingPointSnapResult | null = null;

  for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
    const b = buildings[bIdx];
    if (excludeBuildingId && !excludeWingId && b.id === excludeBuildingId) continue;

    const wings =
      b.wings && b.wings.length > 0
        ? b.wings
        : [{ id: `${b.id}-w1`, x: b.x, z: b.z, footprint: b.footprint }];

    for (let wIdx = 0; wIdx < wings.length; wIdx++) {
      const w = wings[wIdx];
      if (excludeBuildingId && excludeWingId && b.id === excludeBuildingId && w.id === excludeWingId) {
        continue;
      }
      const fp = w.footprint;
      if (!fp || fp.length < 3) continue;

      // Quick bounding cull
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let k = 0; k < fp.length; k++) {
        if (fp[k].x < minX) minX = fp[k].x;
        if (fp[k].x > maxX) maxX = fp[k].x;
        if (fp[k].z < minZ) minZ = fp[k].z;
        if (fp[k].z > maxZ) maxZ = fp[k].z;
      }
      if (
        pt.x < minX - tolerance ||
        pt.x > maxX + tolerance ||
        pt.z < minZ - tolerance ||
        pt.z > maxZ + tolerance
      ) {
        continue;
      }

      // 1. Vertices first (tight exact corner matching)
      for (let i = 0; i < fp.length; i++) {
        const v = fp[i];
        const d = Math.hypot(pt.x - v.x, pt.z - v.z);
        if (d < bestVertexDist) {
          bestVertexDist = d;
          const prev = fp[(i - 1 + fp.length) % fp.length];
          const next = fp[(i + 1) % fp.length];
          bestVertex = {
            x: Math.round(v.x * 10) / 10,
            z: Math.round(v.z * 10) / 10,
            snapped: true,
            snapKind: 'vertex',
            targetBuildingId: b.id,
            snapGuide: [prev, next],
          };
        }
      }

      // 2. Edges
      for (let i = 0; i < fp.length; i++) {
        const a = fp[i];
        const c = fp[(i + 1) % fp.length];
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        const lenSq = dx * dx + dz * dz;
        if (lenSq < 1e-4) continue;
        const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / lenSq));
        const px = a.x + t * dx;
        const pz = a.z + t * dz;
        const d = Math.hypot(pt.x - px, pt.z - pz);
        if (d < bestEdgeDist) {
          bestEdgeDist = d;
          bestEdge = {
            x: Math.round(px * 10) / 10,
            z: Math.round(pz * 10) / 10,
            snapped: true,
            snapKind: 'edge',
            targetBuildingId: b.id,
            snapGuide: [a, c],
          };
        }
      }
    }
  }

  if (bestVertex) return bestVertex;
  if (bestEdge) return bestEdge;
  return {
    x: Math.round(pt.x * 10) / 10,
    z: Math.round(pt.z * 10) / 10,
    snapped: false,
    snapKind: 'none',
  };
}

/**
 * Converts a user's literal mouse-dragged rectangle (startPt -> endPt) into a 3D building
 * footprint, optionally snapping its orientation and facade edge cleanly to the nearest street
 * AND optionally flush (0-gap) against adjacent buildings/wings.
 * Supports arbitrary small or large building dimensions without upper/lower artificial caps.
 */
export function snapBuildingRectToStreet(
  startPt: WorldPoint,
  endPt: WorldPoint,
  streets: StreetSegment[],
  snapToRoad = true,
  maxSnapDistBlocks = 90,
  existingBuildings?: Building3D[],
  excludeBuildingId?: string,
  snapToBuilding = true
): RoadSnappedBuildingRect {
  const rawCx = (startPt.x + endPt.x) * 0.5;
  const rawCz = (startPt.z + endPt.z) * 0.5;
  const rawW = Math.max(1, Math.abs(endPt.x - startPt.x));
  const rawD = Math.max(1, Math.abs(endPt.z - startPt.z));

  const buildUnsnapped = (): RoadSnappedBuildingRect => {
    const cx = Math.round(rawCx * 10) / 10;
    const cz = Math.round(rawCz * 10) / 10;
    const w = Math.max(1, Math.round(rawW * 10) / 10);
    const d = Math.max(1, Math.round(rawD * 10) / 10);
    return {
      x: cx,
      z: cz,
      width: w,
      depth: d,
      angleDeg: 0,
      footprint: createRectFootprint(cx, cz, w, d, 0),
      snapped: false,
    };
  };

  let baseRect: RoadSnappedBuildingRect;

  if (!snapToRoad || streets.length === 0) {
    baseRect = buildUnsnapped();
  } else {
    let bestStreet: StreetSegment | null = null;
    let bestA: WorldPoint | null = null;
    let bestB: WorldPoint | null = null;
    let bestDist = Infinity;

    for (const st of streets) {
      if (st.points.length < 2) continue;
      for (let i = 0; i < st.points.length - 1; i++) {
        const a = st.points[i];
        const b = st.points[i + 1];
        const d = pointToSegmentDistance(rawCx, rawCz, a.x, a.z, b.x, b.z);
        if (d < bestDist) {
          bestDist = d;
          bestStreet = st;
          bestA = a;
          bestB = b;
        }
      }
    }

    if (!bestStreet || !bestA || !bestB || bestDist > maxSnapDistBlocks + Math.max(rawW, rawD) * 0.5) {
      baseRect = buildUnsnapped();
    } else {
      const segDx = bestB.x - bestA.x;
      const segDz = bestB.z - bestA.z;
      const segLen = Math.hypot(segDx, segDz) || 1;
      const ux = segDx / segLen;
      const uz = segDz / segLen;
      const vx = -uz;
      const vz = ux;

      const dragDx = endPt.x - startPt.x;
      const dragDz = endPt.z - startPt.z;
      const localW = Math.max(1, Math.round(Math.abs(dragDx * ux + dragDz * uz) * 10) / 10);
      const localD = Math.max(1, Math.round(Math.abs(dragDx * vx + dragDz * vz) * 10) / 10);

      const relX = rawCx - bestA.x;
      const relZ = rawCz - bestA.z;
      const signedPerp = relX * vx + relZ * vz;
      const sideSign = signedPerp >= 0 ? 1 : -1;

      const roadHalf = Math.max(3, bestStreet.width * 0.5);
      const minClearance = roadHalf + 4 + localD * 0.5;
      const absPerp = Math.abs(signedPerp);

      let finalCx = rawCx;
      let finalCz = rawCz;
      if (absPerp < minClearance + 22) {
        const shift = sideSign * (minClearance - absPerp);
        finalCx += vx * shift;
        finalCz += vz * shift;
      }

      let angleDeg = Math.round(((Math.atan2(uz, ux) * 180) / Math.PI) * 10) / 10;
      if (angleDeg > 90) angleDeg -= 180;
      if (angleDeg < -90) angleDeg += 180;

      const cx = Math.round(finalCx * 10) / 10;
      const cz = Math.round(finalCz * 10) / 10;

      baseRect = {
        x: cx,
        z: cz,
        width: localW,
        depth: localD,
        angleDeg,
        footprint: createRectFootprint(cx, cz, localW, localD, angleDeg),
        snapped: true,
        snappedStreetId: bestStreet.id,
        snappedStreetName: bestStreet.name,
        snappedDistrict: bestStreet.district,
      };
    }
  }

  // Optional flush building-to-building contact so adjacent buildings/wings meet with 0 gap
  if (snapToBuilding && existingBuildings && existingBuildings.length > 0) {
    return snapBuildingRectToNeighbors(baseRect, existingBuildings, excludeBuildingId, 10);
  }
  return baseRect;
}

/**
 * Resizes a 3D building directly from a dragged corner handle (0..3) while keeping
 * the opposite corner anchored in the building's rotated local coordinate frame.
 * No upper dimension cap; supports small structures down to 1x1 m.
 */
export function resizeBuildingFromCornerHandle(
  building: Building3D,
  cornerIdx: number,
  dragWorldPt: WorldPoint
): Building3D {
  const fp = building.footprint;
  if (fp.length < 4) return building;

  const oppIdx = (cornerIdx + 2) % 4;
  const opp = fp[oppIdx];
  const angleDeg = building.orientationDeg ?? 0;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);

  const dx = dragWorldPt.x - opp.x;
  const dz = dragWorldPt.z - opp.z;
  const du = dx * cos - dz * sin;
  const dv = dx * sin + dz * cos;

  const newW = Math.max(1, Math.round(Math.abs(du)));
  const newD = Math.max(1, Math.round(Math.abs(dv)));

  const signU = du >= 0 ? 1 : -1;
  const signV = dv >= 0 ? 1 : -1;
  const halfU = signU * newW * 0.5;
  const halfV = signV * newD * 0.5;

  const cosF = Math.cos(rad);
  const sinF = Math.sin(rad);
  const newCx = Math.round(opp.x + halfU * cosF - halfV * sinF);
  const newCz = Math.round(opp.z + halfU * sinF + halfV * cosF);

  return {
    ...building,
    x: newCx,
    z: newCz,
    measuredWidth: newW,
    measuredDepth: newD,
    footprint: createRectFootprint(newCx, newCz, newW, newD, angleDeg),
    isUserEdited: true,
  };
}

// ---------------------------------------------------------------------------
// Viewport-Aware Interior & Auto-Rotated Territory Label Placement
// ---------------------------------------------------------------------------

interface ScreenPt2D {
  x: number;
  y: number;
}

export interface TerritoryLabelPlacement {
  sx: number;
  sy: number;
  /** Radians in (-PI/2, PI/2] so text is always right-side up */
  angle: number;
  /** Minimum pixel clearance to territory border along the label baseline */
  clearance: number;
  /** True when the full label span stays strictly inside the visible territory polygon */
  fitsInside: boolean;
}

function clipPolyAgainstHalfPlane(
  poly: ScreenPt2D[],
  isInside: (p: ScreenPt2D) => boolean,
  intersect: (a: ScreenPt2D, b: ScreenPt2D) => ScreenPt2D
): ScreenPt2D[] {
  if (poly.length === 0) return [];
  const out: ScreenPt2D[] = [];
  let prev = poly[poly.length - 1];
  let prevIn = isInside(prev);
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const currIn = isInside(curr);
    if (currIn) {
      if (!prevIn) out.push(intersect(prev, curr));
      out.push(curr);
    } else if (prevIn) {
      out.push(intersect(prev, curr));
    }
    prev = curr;
    prevIn = currIn;
  }
  return out;
}

function clipScreenPolygonToRect(
  poly: ScreenPt2D[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): ScreenPt2D[] {
  let res = poly;
  // Left: x >= minX
  res = clipPolyAgainstHalfPlane(
    res,
    (p) => p.x >= minX,
    (a, b) => {
      const t = (minX - a.x) / (b.x - a.x || 1e-9);
      return { x: minX, y: a.y + (b.y - a.y) * t };
    }
  );
  // Right: x <= maxX
  res = clipPolyAgainstHalfPlane(
    res,
    (p) => p.x <= maxX,
    (a, b) => {
      const t = (maxX - a.x) / (b.x - a.x || 1e-9);
      return { x: maxX, y: a.y + (b.y - a.y) * t };
    }
  );
  // Top: y >= minY
  res = clipPolyAgainstHalfPlane(
    res,
    (p) => p.y >= minY,
    (a, b) => {
      const t = (minY - a.y) / (b.y - a.y || 1e-9);
      return { x: a.x + (b.x - a.x) * t, y: minY };
    }
  );
  // Bottom: y <= maxY
  res = clipPolyAgainstHalfPlane(
    res,
    (p) => p.y <= maxY,
    (a, b) => {
      const t = (maxY - a.y) / (b.y - a.y || 1e-9);
      return { x: a.x + (b.x - a.x) * t, y: maxY };
    }
  );
  return res;
}

function screenPolySignedArea(poly: ScreenPt2D[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return sum * 0.5;
}

export function pointInScreenPolygon(px: number, py: number, poly: ScreenPt2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToScreenPolygonEdges(px: number, py: number, poly: ScreenPt2D[]): number {
  let minSq = Infinity;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[j].x;
    const ay = poly[j].y;
    const bx = poly[i].x;
    const by = poly[i].y;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 1e-9) {
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    }
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const dSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

function measureRayToPolyBoundary(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  poly: ScreenPt2D[]
): number {
  let bestT = Infinity;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[j].x;
    const ay = poly[j].y;
    const ex = poly[i].x - ax;
    const ey = poly[i].y - ay;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const qpx = ax - ox;
    const qpy = ay - oy;
    const t = (qpx * ey - qpy * ex) / denom;
    const u = (qpx * dy - qpy * dx) / denom;
    if (t > 1e-4 && u >= -1e-4 && u <= 1 + 1e-4 && t < bestT) {
      bestT = t;
    }
  }
  return Number.isFinite(bestT) ? bestT : 0;
}

function normalizeLabelAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI * 0.5) a -= Math.PI;
  while (a <= -Math.PI * 0.5) a += Math.PI;
  return a;
}

/**
 * Computes an optimal strictly-interior, viewport-visible, and adaptively rotated label
 * placement for arbitrary (possibly concave, C-shaped, ring-like, or diagonal river)
 * land/water territory polygons.
 *
 * Guarantees:
 * - Anchor is strictly INSIDE the clipped visible polygon (never on land outside a curved river).
 * - Stays within the active camera viewport so long rivers/parks remain readable as you pan.
 * - Keeps text horizontal when it fits comfortably; rotates parallel to the local corridor/banks
 *   when needed so the label fits inside elongated or diagonal territories.
 */
export function computeTerritoryLabelPlacement(
  screenPoly: ScreenPt2D[],
  viewportWidth: number,
  viewportHeight: number,
  labelWidthPx: number,
  labelHeightPx = 14
): TerritoryLabelPlacement | null {
  if (screenPoly.length < 3) return null;

  const padX = Math.min(32, viewportWidth * 0.08);
  const padY = Math.min(28, viewportHeight * 0.08);
  let clipped = clipScreenPolygonToRect(
    screenPoly,
    padX,
    padY,
    Math.max(padX + 1, viewportWidth - padX),
    Math.max(padY + 1, viewportHeight - padY)
  );
  if (clipped.length < 3 || Math.abs(screenPolySignedArea(clipped)) < 110) {
    clipped = clipScreenPolygonToRect(screenPoly, 4, 4, viewportWidth - 4, viewportHeight - 4);
  }
  if (clipped.length < 3) return null;

  const signedArea = screenPolySignedArea(clipped);
  const absArea = Math.abs(signedArea);
  if (absArea < 120) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < clipped.length; i++) {
    const p = clipped[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 6 && spanY < 6) return null;

  const viewCx = viewportWidth * 0.5;
  const viewCy = viewportHeight * 0.5;
  const viewDiag = Math.max(1, Math.hypot(viewportWidth, viewportHeight));

  // Build interior seed candidates:
  // 1) Area-weighted centroid
  // 2) 9x9 grid over visible AABB
  // 3) Edge-normal inward probes (catches narrow diagonal river ribbons between grid nodes!)
  const seeds: Array<{ x: number; y: number; dist: number; score: number }> = [];
  const considerPoint = (px: number, py: number) => {
    if (!pointInScreenPolygon(px, py, clipped)) return;
    const d = distToScreenPolygonEdges(px, py, clipped);
    if (d <= 0.5) return;
    const centerBias = 1 - Math.hypot(px - viewCx, py - viewCy) / viewDiag;
    // Clearance is primary; gentle viewport-centering tie-breaker keeps river names near screen center
    const score = d + centerBias * Math.min(8, d * 0.22);
    seeds.push({ x: px, y: py, dist: d, score });
  };

  // Centroid
  let cxSum = 0;
  let cySum = 0;
  for (let i = 0, j = clipped.length - 1; i < clipped.length; j = i++) {
    const f = clipped[j].x * clipped[i].y - clipped[i].x * clipped[j].y;
    cxSum += (clipped[j].x + clipped[i].x) * f;
    cySum += (clipped[j].y + clipped[i].y) * f;
  }
  if (Math.abs(signedArea) > 1e-4) {
    considerPoint(cxSum / (6 * signedArea), cySum / (6 * signedArea));
  }

  // Coarse 9x9 grid
  const gridN = 9;
  const stepX = spanX / gridN;
  const stepY = spanY / gridN;
  for (let gy = 0; gy < gridN; gy++) {
    const py = minY + (gy + 0.5) * stepY;
    for (let gx = 0; gx < gridN; gx++) {
      const px = minX + (gx + 0.5) * stepX;
      considerPoint(px, py);
    }
  }

  // Edge-normal inward probes (essential for narrow diagonal river channels!)
  const normalSign = signedArea >= 0 ? -1 : 1;
  const maxProbeEdges = Math.min(clipped.length, 40);
  const edgeStride = Math.max(1, Math.floor(clipped.length / maxProbeEdges));
  for (let i = 0; i < clipped.length; i += edgeStride) {
    const a = clipped[i];
    const b = clipped[(i + 1) % clipped.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 4) continue;
    const inNx = (-ey / len) * normalSign;
    const inNy = (ex / len) * normalSign;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    for (const offset of [3, 8, 16, 30]) {
      considerPoint(mx + inNx * offset, my + inNy * offset);
    }
  }

  if (seeds.length === 0) return null;

  // Sort seeds and locally refine top 3 candidates (2 refinement levels -> accurate pole of inaccessibility)
  seeds.sort((a, b) => b.score - a.score);
  let best = seeds[0];
  const topK = Math.min(3, seeds.length);
  for (let k = 0; k < topK; k++) {
    let cur = seeds[k];
    let rx = Math.max(4, stepX * 0.55);
    let ry = Math.max(4, stepY * 0.55);
    for (let iter = 0; iter < 2; iter++) {
      let improved = cur;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cur.x + dx * rx;
          const ny = cur.y + dy * ry;
          if (!pointInScreenPolygon(nx, ny, clipped)) continue;
          const d = distToScreenPolygonEdges(nx, ny, clipped);
          const centerBias = 1 - Math.hypot(nx - viewCx, ny - viewCy) / viewDiag;
          const sc = d + centerBias * Math.min(8, d * 0.22);
          if (sc > improved.score) {
            improved = { x: nx, y: ny, dist: d, score: sc };
          }
        }
      }
      cur = improved;
      rx *= 0.45;
      ry *= 0.45;
    }
    if (cur.score > best.score) best = cur;
  }

  const effWidth = Math.max(20, labelWidthPx);
  const halfH = labelHeightPx * 0.5;

  // Evaluate any candidate orientation angle at the interior pole
  const evaluateAngle = (rawAngle: number) => {
    const angle = normalizeLabelAngle(rawAngle);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const tPos = measureRayToPolyBoundary(best.x, best.y, ux, uy, clipped);
    const tNeg = measureRayToPolyBoundary(best.x, best.y, -ux, -uy, clipped);
    const chordLen = tPos + tNeg;

    // Gently recenter along the interior chord if it keeps strong clearance
    let cx = best.x;
    let cy = best.y;
    if (chordLen > 4) {
      const shift = (tPos - tNeg) * 0.5;
      const clampedShift = Math.max(-chordLen * 0.3, Math.min(chordLen * 0.3, shift));
      const candX = best.x + ux * clampedShift;
      const candY = best.y + uy * clampedShift;
      if (
        pointInScreenPolygon(candX, candY, clipped) &&
        distToScreenPolygonEdges(candX, candY, clipped) >= best.dist * 0.72
      ) {
        cx = candX;
        cy = candY;
      }
    }

    const sampleFracs = [-0.46, -0.23, 0, 0.23, 0.46];
    let insideCount = 0;
    let minClear = Infinity;
    for (let s = 0; s < sampleFracs.length; s++) {
      const sx = cx + ux * (effWidth * sampleFracs[s]);
      const sy = cy + uy * (effWidth * sampleFracs[s]);
      if (pointInScreenPolygon(sx, sy, clipped)) {
        insideCount++;
        const d = distToScreenPolygonEdges(sx, sy, clipped);
        if (d < minClear) minClear = d;
      } else {
        minClear = 0;
      }
    }
    if (!Number.isFinite(minClear)) minClear = 0;

    const fitsInside =
      insideCount === sampleFracs.length &&
      chordLen >= effWidth + 6 &&
      minClear >= Math.min(halfH * 0.75, best.dist * 0.55);

    const score =
      (fitsInside ? 1200 : 0) +
      insideCount * 140 +
      Math.min(chordLen, effWidth * 1.5) * 2.4 +
      Math.min(minClear, labelHeightPx * 1.5) * 18 -
      Math.abs(angle) * 22;

    return { sx: cx, sy: cy, angle, clearance: minClear, fitsInside, score };
  };

  // Prefer horizontal (0°) whenever the label fits cleanly inside the territory!
  const horiz = evaluateAngle(0);
  if (horiz.fitsInside && horiz.clearance >= halfH * 0.85) {
    return {
      sx: horiz.sx,
      sy: horiz.sy,
      angle: 0,
      clearance: horiz.clearance,
      fitsInside: true,
    };
  }

  // Collect candidate angles: 12 uniform angles + nearest local polygon edge directions
  const candidateAngles: number[] = [];
  for (let i = 0; i < 12; i++) {
    candidateAngles.push(-Math.PI * 0.5 + ((i + 1) * Math.PI) / 12);
  }
  const edgeDists: Array<{ distSq: number; angle: number }> = [];
  for (let i = 0, j = clipped.length - 1; i < clipped.length; j = i++) {
    const ax = clipped[j].x;
    const ay = clipped[j].y;
    const bx = clipped[i].x;
    const by = clipped[i].y;
    const ex = bx - ax;
    const ey = by - ay;
    const lenSq = ex * ex + ey * ey;
    if (lenSq < 36) continue;
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    edgeDists.push({
      distSq: (mx - best.x) * (mx - best.x) + (my - best.y) * (my - best.y),
      angle: normalizeLabelAngle(Math.atan2(ey, ex)),
    });
  }
  edgeDists.sort((a, b) => a.distSq - b.distSq);
  for (let i = 0; i < Math.min(6, edgeDists.length); i++) {
    candidateAngles.push(edgeDists[i].angle);
  }

  let bestPlacement = horiz;
  for (let i = 0; i < candidateAngles.length; i++) {
    const cand = evaluateAngle(candidateAngles[i]);
    if (cand.score > bestPlacement.score) {
      bestPlacement = cand;
    }
  }

  return {
    sx: bestPlacement.sx,
    sy: bestPlacement.sy,
    angle: bestPlacement.angle,
    clearance: bestPlacement.clearance,
    fitsInside: bestPlacement.fitsInside,
  };
}

export interface LandSnapResult {
  x: number;
  z: number;
  snapped: boolean;
  snapKind: 'vertex' | 'edge' | 'none';
  targetLandId?: string;
  targetLandName?: string;
  targetKind?: LandFeature['kind'];
  snapEdge?: [WorldPoint, WorldPoint];
}

/**
 * Magnetically snaps a cursor or dragged vertex onto existing territory polygons:
 * 1. Exact vertex (node) snapping has highest priority for flush multi-territory mosaics
 *    (large water bodies, contiguous forests/parks, tiled squares).
 * 2. Orthogonal edge snapping serves as secondary fallback for T-junction boundaries.
 */
export function snapPointToLandFeatures(
  pt: WorldPoint,
  landFeatures: LandFeature[],
  maxSnapDist = 16,
  excludeLandId?: string
): LandSnapResult {
  let bestVertexDist = maxSnapDist;
  let bestVertex: LandSnapResult | null = null;

  // Slightly tighter edge tolerance so nearby territory nodes always win cleanly over edges
  let bestEdgeDist = maxSnapDist * 0.72;
  let bestEdge: LandSnapResult | null = null;

  for (let fi = 0; fi < landFeatures.length; fi++) {
    const feat = landFeatures[fi];
    if (excludeLandId && feat.id === excludeLandId) continue;
    const poly = feat.polygon;
    const n = poly.length;
    if (n < 3) continue;

    // 1. Check exact polygon vertices (nodes)
    for (let i = 0; i < n; i++) {
      const v = poly[i];
      const d = Math.hypot(pt.x - v.x, pt.z - v.z);
      if (d < bestVertexDist) {
        bestVertexDist = d;
        bestVertex = {
          x: v.x,
          z: v.z,
          snapped: true,
          snapKind: 'vertex',
          targetLandId: feat.id,
          targetLandName: feat.name,
          targetKind: feat.kind,
        };
      }
    }

    // 2. Check polygon boundary edges
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 1e-4) continue;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / lenSq));
      const px = a.x + t * dx;
      const pz = a.z + t * dz;
      const d = Math.hypot(pt.x - px, pt.z - pz);
      if (d < bestEdgeDist) {
        bestEdgeDist = d;
        bestEdge = {
          x: Math.round(px * 10) / 10,
          z: Math.round(pz * 10) / 10,
          snapped: true,
          snapKind: 'edge',
          targetLandId: feat.id,
          targetLandName: feat.name,
          targetKind: feat.kind,
          snapEdge: [a, b],
        };
      }
    }
  }

  if (bestVertex) return bestVertex;
  if (bestEdge) return bestEdge;

  return {
    x: Math.round(pt.x),
    z: Math.round(pt.z),
    snapped: false,
    snapKind: 'none',
  };
}



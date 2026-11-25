import type { Building3D, BuildingWing, WorldPoint } from '../types/map';
import {
  createCircleFootprint,
  createParallelogramFootprint,
  createRectFootprint,
  createTriangleFootprint,
  pointToSegmentDistance,
} from './projection';
import { SERVER_GROUND_Y, snapPointToBuildings } from './geometry';

/**
 * Infers which bounding-box corner (0=NW, 1=NE, 2=SE, 3=SW) holds the 90° right angle
 * for an existing 3-vertex triangular footprint rotated by `angleDeg` around `(cx, cz)`.
 */
export function detectTriangleCornerFromFootprint(
  footprint: WorldPoint[],
  cx: number,
  cz: number,
  angleDeg = 0
): 0 | 1 | 2 | 3 {
  if (footprint.length !== 3) return 0;
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const local = footprint.map((p) => {
    const dx = p.x - cx;
    const dz = p.z - cz;
    return { u: dx * cos - dz * sin, v: dx * sin + dz * cos };
  });

  // Identify which quadrant of the 4 box corners is MISSING -> opposite corner is the 90° corner!
  const quadrants: Array<[number, number]> = [
    [-1, -1], // 0: NW
    [1, -1],  // 1: NE
    [1, 1],   // 2: SE
    [-1, 1],  // 3: SW
  ];
  let missingCorner = 2;
  let maxMinDist = -1;
  const scaleU = Math.max(1, ...local.map((p) => Math.abs(p.u)));
  const scaleV = Math.max(1, ...local.map((p) => Math.abs(p.v)));

  for (let q = 0; q < 4; q++) {
    const [qu, qv] = quadrants[q];
    let minD = Infinity;
    for (const pt of local) {
      const d = Math.hypot(pt.u / scaleU - qu, pt.v / scaleV - qv);
      if (d < minD) minD = d;
    }
    if (minD > maxMinDist) {
      maxMinDist = minD;
      missingCorner = q;
    }
  }
  return ((missingCorner + 2) % 4) as 0 | 1 | 2 | 3;
}

/**
 * Infers the oblique shear angle (`skewDeg` in -60..60°) for a 4-vertex parallelogram footprint
 * rotated by `angleDeg` around `(cx, cz)`.
 */
export function detectParallelogramSkewFromFootprint(
  footprint: WorldPoint[],
  cx: number,
  cz: number,
  angleDeg = 0
): number {
  if (footprint.length !== 4) return 25;
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = footprint.map((p) => {
    const dx = p.x - cx;
    const dz = p.z - cz;
    return { u: dx * cos - dz * sin, v: dx * sin + dz * cos };
  });
  const topMidU = (local[0].u + local[1].u) * 0.5;
  const botMidU = (local[2].u + local[3].u) * 0.5;
  const topMidV = (local[0].v + local[1].v) * 0.5;
  const botMidV = (local[2].v + local[3].v) * 0.5;
  const depth = Math.max(0.5, Math.abs(botMidV - topMidV));
  const rawDeg = (Math.atan2(topMidU - botMidU, depth) * 180) / Math.PI;
  const clamped = Math.max(-60, Math.min(60, rawDeg));
  return Math.round(clamped * 2) / 2;
}

export function normalizeAngleDeg(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a <= -180) a += 360;
  return Math.round(a * 10) / 10;
}

/**
 * Computes signed polygon area (in world X,Z) — positive for clockwise winding in screen-like X-right, Z-down coords.
 */
export function computeFootprintSignedArea(pts: WorldPoint[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum * 0.5;
}

/**
 * Ensures clockwise winding in (x, z) so 3D wall extrusion & backface culling match rectangular footprints.
 */
export function ensureClockwiseFootprint(pts: WorldPoint[]): WorldPoint[] {
  if (pts.length < 3) return pts;
  return computeFootprintSignedArea(pts) < 0 ? [...pts].reverse() : pts;
}

/**
 * Computes area-weighted centroid and bounding dimensions of an arbitrary polygon footprint.
 */
export function computePolygonCentroidAndDims(pts: WorldPoint[]): {
  x: number;
  z: number;
  width: number;
  depth: number;
  area: number;
} {
  if (pts.length === 0) return { x: 0, z: 0, width: 1, depth: 1, area: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let avgX = 0;
  let avgZ = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    avgX += p.x;
    avgZ += p.z;
  }
  avgX /= pts.length;
  avgZ /= pts.length;

  let area2 = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = a.x * b.z - b.x * a.z;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  const absArea = Math.abs(area2) * 0.5;
  if (Math.abs(area2) > 1e-4) {
    cx /= 3 * area2;
    cz /= 3 * area2;
  } else {
    cx = avgX;
    cz = avgZ;
  }

  return {
    x: Math.round(cx * 10) / 10,
    z: Math.round(cz * 10) / 10,
    width: Math.max(1, Math.round((maxX - minX) * 10) / 10),
    depth: Math.max(1, Math.round((maxZ - minZ) * 10) / 10),
    area: absArea,
  };
}

/**
 * Returns the canonical list of architectural wings (корпуса) for any building.
 * Single-volume buildings return a 1-element array representing their primary geometry.
 */
export function getBuildingWings(building: Building3D): BuildingWing[] {
  if (building.wings && building.wings.length > 0) {
    return building.wings;
  }
  const spanX =
    building.footprint.length > 0
      ? Math.max(...building.footprint.map((p) => p.x)) -
        Math.min(...building.footprint.map((p) => p.x))
      : 28;
  const spanZ =
    building.footprint.length > 0
      ? Math.max(...building.footprint.map((p) => p.z)) -
        Math.min(...building.footprint.map((p) => p.z))
      : 20;

  return [
    {
      id: `${building.id}-w1`,
      label: 'Корпус 1',
      x: building.x,
      z: building.z,
      footprint: building.footprint,
      height: building.height,
      floors: building.floors,
      baseY: building.baseY ?? SERVER_GROUND_Y,
      roofY: building.roofY ?? (building.baseY ?? SERVER_GROUND_Y) + building.height,
      roofType: building.roofType ?? 'flat',
      shapeType: building.shapeType,
      measuredWidth: Math.max(1, Math.round(building.measuredWidth ?? spanX)),
      measuredDepth: Math.max(1, Math.round(building.measuredDepth ?? spanZ)),
      orientationDeg: building.orientationDeg ?? 0,
      skewDeg: building.skewDeg,
    },
  ];
}

/**
 * Synchronizes top-level Building3D fields from its wings list.
 * When only 1 wing remains, collapses `wings` back to `undefined` for compact storage.
 */
export function syncBuildingFromWings(building: Building3D, wings: BuildingWing[]): Building3D {
  if (wings.length === 0) return building;
  const primary = wings[0];
  const maxHeight = Math.max(...wings.map((w) => w.height));
  const maxFloors = Math.max(...wings.map((w) => w.floors));

  if (wings.length === 1) {
    return {
      ...building,
      x: primary.x,
      z: primary.z,
      footprint: primary.footprint,
      height: primary.height,
      floors: primary.floors,
      baseY: primary.baseY ?? building.baseY ?? SERVER_GROUND_Y,
      roofY:
        primary.roofY ??
        (primary.baseY ?? building.baseY ?? SERVER_GROUND_Y) + primary.height,
      roofType: primary.roofType ?? building.roofType ?? 'flat',
      shapeType: primary.shapeType ?? building.shapeType,
      measuredWidth: primary.measuredWidth,
      measuredDepth: primary.measuredDepth,
      orientationDeg: primary.orientationDeg ?? 0,
      skewDeg: primary.skewDeg,
      wings: undefined,
      isUserEdited: true,
    };
  }

  return {
    ...building,
    x: primary.x,
    z: primary.z,
    footprint: primary.footprint,
    height: maxHeight,
    floors: maxFloors,
    baseY: primary.baseY ?? building.baseY ?? SERVER_GROUND_Y,
    roofY: (primary.baseY ?? building.baseY ?? SERVER_GROUND_Y) + maxHeight,
    roofType: primary.roofType ?? building.roofType ?? 'flat',
    measuredWidth: primary.measuredWidth,
    measuredDepth: primary.measuredDepth,
    orientationDeg: primary.orientationDeg ?? 0,
    skewDeg: primary.skewDeg,
    shapeType: 'complex',
    wings: wings.map((w, idx) => ({
      ...w,
      label: w.label || `Корпус ${idx + 1}`,
    })),
    isUserEdited: true,
  };
}

function rotatePointAround(pt: WorldPoint, cx: number, cz: number, deltaRad: number): WorldPoint {
  const cos = Math.cos(deltaRad);
  const sin = Math.sin(deltaRad);
  const dx = pt.x - cx;
  const dz = pt.z - cz;
  return {
    x: Math.round((cx + dx * cos - dz * sin) * 10) / 10,
    z: Math.round((cz + dx * sin + dz * cos) * 10) / 10,
  };
}

function measureWingDims(wing: BuildingWing): { width: number; depth: number } {
  if (wing.measuredWidth && wing.measuredDepth) {
    return { width: wing.measuredWidth, depth: wing.measuredDepth };
  }
  if (wing.footprint.length >= 4) {
    const w = Math.hypot(
      wing.footprint[1].x - wing.footprint[0].x,
      wing.footprint[1].z - wing.footprint[0].z
    );
    const d = Math.hypot(
      wing.footprint[2].x - wing.footprint[1].x,
      wing.footprint[2].z - wing.footprint[1].z
    );
    return { width: Math.max(1, Math.round(w)), depth: Math.max(1, Math.round(d)) };
  }
  return { width: 24, depth: 18 };
}

/**
 * Rotates a building (or a specific wing of a complex building) to `nextAngleDeg`
 * cleanly around its own center (or around the building pivot when rotating all wings).
 */
export function rotateBuilding(
  building: Building3D,
  nextAngleDeg: number,
  wingId?: string
): Building3D {
  const normAngle = normalizeAngleDeg(nextAngleDeg);
  const wings = getBuildingWings(building);

  if (wings.length === 1 || wingId) {
    const targetId = wingId ?? wings[0].id;
    const nextWings = wings.map((w) => {
      if (w.id !== targetId) return w;
      const dims = measureWingDims(w);
      const isFreeform = w.shapeType === 'freeform';
      const isCircular = !isFreeform && (w.shapeType === 'circular' || w.footprint.length > 4);
      const isTriangular = !isFreeform && (w.shapeType === 'triangular' || w.footprint.length === 3);
      const isParallelogram = !isFreeform && w.shapeType === 'parallelogram' && w.footprint.length === 4;
      const isQuad = !isFreeform && !isParallelogram && w.footprint.length === 4;
      const prevAngle = w.orientationDeg ?? 0;
      const deltaRad = ((normAngle - prevAngle) * Math.PI) / 180;
      const skewDeg = isParallelogram
        ? w.skewDeg ?? detectParallelogramSkewFromFootprint(w.footprint, w.x, w.z, prevAngle)
        : w.skewDeg;
      const nextFootprint = isFreeform
        ? w.footprint.map((pt) => rotatePointAround(pt, w.x, w.z, deltaRad))
        : isCircular
        ? createCircleFootprint(w.x, w.z, dims.width, dims.depth, normAngle, w.footprint.length)
        : isTriangular
        ? createTriangleFootprint(
            w.x,
            w.z,
            dims.width,
            dims.depth,
            normAngle,
            detectTriangleCornerFromFootprint(w.footprint, w.x, w.z, prevAngle)
          )
        : isParallelogram
        ? createParallelogramFootprint(w.x, w.z, dims.width, dims.depth, normAngle, skewDeg ?? 25)
        : isQuad
        ? createRectFootprint(w.x, w.z, dims.width, dims.depth, normAngle)
        : w.footprint.map((pt) => rotatePointAround(pt, w.x, w.z, deltaRad));
      return {
        ...w,
        measuredWidth: dims.width,
        measuredDepth: dims.depth,
        orientationDeg: normAngle,
        skewDeg,
        footprint: nextFootprint,
      };
    });
    return syncBuildingFromWings(building, nextWings);
  }

  // Rotate entire complex around centroid of all wings
  const cx = wings.reduce((acc, w) => acc + w.x, 0) / wings.length;
  const cz = wings.reduce((acc, w) => acc + w.z, 0) / wings.length;
  const prevAngle = building.orientationDeg ?? 0;
  const deltaDeg = normAngle - prevAngle;
  const deltaRad = (deltaDeg * Math.PI) / 180;

  const nextWings = wings.map((w) => {
    const newCenter = rotatePointAround({ x: w.x, z: w.z }, cx, cz, deltaRad);
    const dims = measureWingDims(w);
    const wingAngle = normalizeAngleDeg((w.orientationDeg ?? 0) + deltaDeg);
    const isFreeform = w.shapeType === 'freeform';
    const isParallelogram = !isFreeform && w.shapeType === 'parallelogram' && w.footprint.length === 4;
    const nextFootprint = isFreeform
      ? w.footprint.map((pt) => rotatePointAround(pt, cx, cz, deltaRad))
      : isParallelogram
      ? createParallelogramFootprint(
          newCenter.x,
          newCenter.z,
          dims.width,
          dims.depth,
          wingAngle,
          w.skewDeg ?? detectParallelogramSkewFromFootprint(w.footprint, w.x, w.z, w.orientationDeg ?? 0)
        )
      : w.footprint.length === 4
      ? createRectFootprint(newCenter.x, newCenter.z, dims.width, dims.depth, wingAngle)
      : w.footprint.map((pt) => rotatePointAround(pt, cx, cz, deltaRad));
    return {
      ...w,
      x: newCenter.x,
      z: newCenter.z,
      orientationDeg: wingAngle,
      footprint: nextFootprint,
    };
  });

  return syncBuildingFromWings(building, nextWings);
}

/**
 * Resizes a specific wing of a building from one of its 4 corner handles while anchoring the opposite corner.
 * Optionally snaps the dragged edges flush (0-gap) against nearby neighbor buildings/wings.
 */
export function resizeBuildingWingCorner(
  building: Building3D,
  wingId: string | undefined,
  cornerIdx: number,
  dragWorldPt: WorldPoint,
  neighborBuildings?: Building3D[],
  snapTolerance = 8
): Building3D {
  const wings = getBuildingWings(building);
  const targetId = wingId ?? wings[0].id;

  const nextWings = wings.map((w) => {
    if (w.id !== targetId) return w;
    const fp = w.footprint;
    if (fp.length < 3) return w;

    const isFreeform = w.shapeType === 'freeform';
    const isCircular = !isFreeform && (w.shapeType === 'circular' || fp.length > 4);
    const isTriangular = !isFreeform && (w.shapeType === 'triangular' || fp.length === 3);
    const isParallelogram = !isFreeform && w.shapeType === 'parallelogram' && fp.length === 4;
    const angleDeg = w.orientationDeg ?? 0;
    const dims = measureWingDims(w);
    const triCorner = isTriangular
      ? detectTriangleCornerFromFootprint(fp, w.x, w.z, angleDeg)
      : 0;
    const skewDeg = isParallelogram
      ? w.skewDeg ?? detectParallelogramSkewFromFootprint(fp, w.x, w.z, angleDeg)
      : undefined;
    const boxCorners =
      isCircular || isTriangular || isParallelogram || isFreeform
        ? createRectFootprint(w.x, w.z, dims.width, dims.depth, angleDeg)
        : fp;

    const oppIdx = (cornerIdx + 2) % 4;
    const opp = boxCorners[oppIdx];
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(-rad);
    const sin = Math.sin(-rad);

    const dx = dragWorldPt.x - opp.x;
    const dz = dragWorldPt.z - opp.z;
    let du = dx * cos - dz * sin;
    let dv = dx * sin + dz * cos;

    // Optional magnetic flush-snap in the wing's local (u, v) frame against other wings / neighbor buildings
    if (!isCircular && neighborBuildings && neighborBuildings.length > 0 && snapTolerance > 0) {
      let bestDuDelta = snapTolerance + 1;
      let snappedDu = du;
      let bestDvDelta = snapTolerance + 1;
      let snappedDv = dv;

      for (const nb of neighborBuildings) {
        const nbWings = getBuildingWings(nb);
        for (const nbw of nbWings) {
          if (nb.id === building.id && nbw.id === w.id) continue;
          if (!nbw.footprint || nbw.footprint.length < 3) continue;
          // Quick distance cull
          if (Math.hypot(nbw.x - w.x, nbw.z - w.z) > Math.max(dims.width, dims.depth) + 180) {
            continue;
          }
          for (const pt of nbw.footprint) {
            const pdx = pt.x - opp.x;
            const pdz = pt.z - opp.z;
            const pu = pdx * cos - pdz * sin;
            const pv = pdx * sin + pdz * cos;

            const deltaU = Math.abs(pu - du);
            const deltaV = Math.abs(pv - dv);
            // Snap U edge if V overlaps or is near the dragged span
            const minV = Math.min(0, dv) - snapTolerance * 2;
            const maxV = Math.max(0, dv) + snapTolerance * 2;
            if (deltaU < bestDuDelta && pv >= minV && pv <= maxV) {
              bestDuDelta = deltaU;
              snappedDu = pu;
            }
            // Snap V edge if U overlaps or is near the dragged span
            const minU = Math.min(0, du) - snapTolerance * 2;
            const maxU = Math.max(0, du) + snapTolerance * 2;
            if (deltaV < bestDvDelta && pu >= minU && pu <= maxU) {
              bestDvDelta = deltaV;
              snappedDv = pv;
            }
          }
        }
      }

      if (bestDuDelta <= snapTolerance && Math.abs(snappedDu) >= 1) {
        du = snappedDu;
      }
      if (bestDvDelta <= snapTolerance && Math.abs(snappedDv) >= 1) {
        dv = snappedDv;
      }
    }

    const newW = Math.max(1, Math.round(Math.abs(du) * 10) / 10);
    const newD = Math.max(1, Math.round(Math.abs(dv) * 10) / 10);

    const signU = du >= 0 ? 1 : -1;
    const signV = dv >= 0 ? 1 : -1;
    const halfU = signU * newW * 0.5;
    const halfV = signV * newD * 0.5;

    const cosF = Math.cos(rad);
    const sinF = Math.sin(rad);
    const newCx = Math.round((opp.x + halfU * cosF - halfV * sinF) * 10) / 10;
    const newCz = Math.round((opp.z + halfU * sinF + halfV * cosF) * 10) / 10;

    return {
      ...w,
      x: newCx,
      z: newCz,
      measuredWidth: Math.max(1, Math.round(newW)),
      measuredDepth: Math.max(1, Math.round(newD)),
      skewDeg,
      footprint: isCircular
        ? createCircleFootprint(newCx, newCz, newW, newD, angleDeg, fp.length)
        : isTriangular
        ? createTriangleFootprint(newCx, newCz, newW, newD, angleDeg, triCorner)
        : isParallelogram
        ? createParallelogramFootprint(newCx, newCz, newW, newD, angleDeg, skewDeg ?? 25)
        : createRectFootprint(newCx, newCz, newW, newD, angleDeg),
    };
  });

  return syncBuildingFromWings(building, nextWings);
}

/**
 * Updates height & floor count of a specific wing (or the primary body).
 */
export function resizeBuildingWingHeight(
  building: Building3D,
  wingId: string | undefined,
  nextHeight: number
): Building3D {
  const clampedH = Math.max(2, Math.round(nextHeight));
  const nextFloors = Math.max(1, Math.round(clampedH / 3.8));
  const wings = getBuildingWings(building);
  const targetId = wingId ?? wings[0].id;

  const nextWings = wings.map((w) => {
    if (w.id !== targetId) return w;
    const baseY = w.baseY ?? building.baseY ?? SERVER_GROUND_Y;
    return {
      ...w,
      height: clampedH,
      floors: nextFloors,
      baseY,
      roofY: baseY + clampedH,
    };
  });

  return syncBuildingFromWings(building, nextWings);
}

/**
 * Translates a specific wing (or the entire building) by (dx, dz) blocks.
 */
export function moveBuildingWing(
  building: Building3D,
  wingId: string | undefined,
  dx: number,
  dz: number
): Building3D {
  const rdx = Math.round(dx * 10) / 10;
  const rdz = Math.round(dz * 10) / 10;
  if (rdx === 0 && rdz === 0) return building;

  const wings = getBuildingWings(building);
  const targetId = wingId ?? wings[0].id;

  const nextWings = wings.map((w) => {
    if (w.id !== targetId) return w;
    return {
      ...w,
      x: Math.round((w.x + rdx) * 10) / 10,
      z: Math.round((w.z + rdz) * 10) / 10,
      footprint: w.footprint.map((pt) => ({
        x: Math.round((pt.x + rdx) * 10) / 10,
        z: Math.round((pt.z + rdz) * 10) / 10,
      })),
    };
  });

  return syncBuildingFromWings(building, nextWings);
}

export interface MoveBuildingResult {
  building: Building3D;
  snapped: boolean;
  snapGuide?: [WorldPoint, WorldPoint];
}

/**
 * Freely moves an entire building (all wings) OR a single specified `wingId` by `(dx, dz)` blocks,
 * with optional magnetic snap-to-building (flush edge-to-edge or vertex-to-vertex 0-gap contact).
 */
export function moveBuilding(
  building: Building3D,
  dx: number,
  dz: number,
  options: {
    wingId?: string;
    neighborBuildings?: Building3D[];
    snapToBuilding?: boolean;
    snapTolerance?: number;
  } = {}
): MoveBuildingResult {
  const { wingId, neighborBuildings = [], snapToBuilding = true, snapTolerance = 9 } = options;
  const origWings = getBuildingWings(building);
  const moveSingleWing = Boolean(wingId && origWings.length > 1);

  const translatedWings = origWings.map((w) => {
    if (moveSingleWing && w.id !== wingId) return w;
    return {
      ...w,
      x: Math.round((w.x + dx) * 10) / 10,
      z: Math.round((w.z + dz) * 10) / 10,
      footprint: w.footprint.map((pt) => ({
        x: Math.round((pt.x + dx) * 10) / 10,
        z: Math.round((pt.z + dz) * 10) / 10,
      })),
    };
  });

  if (!snapToBuilding || snapTolerance <= 0) {
    return {
      building: syncBuildingFromWings(building, translatedWings),
      snapped: false,
    };
  }

  const movingWings = moveSingleWing
    ? translatedWings.filter((w) => w.id === wingId)
    : translatedWings;

  // Gather candidate neighbor footprints (other buildings + unmoved sibling wings when moving a single wing)
  const targetPolys: Array<{ fp: WorldPoint[]; cx: number; cz: number; maxR: number }> = [];
  if (moveSingleWing) {
    for (const sw of origWings) {
      if (sw.id === wingId || sw.footprint.length < 3) continue;
      const maxR = Math.max(
        10,
        ...sw.footprint.map((p) => Math.hypot(p.x - sw.x, p.z - sw.z))
      );
      targetPolys.push({ fp: sw.footprint, cx: sw.x, cz: sw.z, maxR });
    }
  }
  for (let i = 0; i < neighborBuildings.length; i++) {
    const nb = neighborBuildings[i];
    if (nb.id === building.id) continue;
    const nbWings = getBuildingWings(nb);
    for (let j = 0; j < nbWings.length; j++) {
      const nbw = nbWings[j];
      if (!nbw.footprint || nbw.footprint.length < 3) continue;
      const maxR = Math.max(
        10,
        ...nbw.footprint.map((p) => Math.hypot(p.x - nbw.x, p.z - nbw.z))
      );
      targetPolys.push({ fp: nbw.footprint, cx: nbw.x, cz: nbw.z, maxR });
    }
  }

  if (targetPolys.length === 0) {
    return {
      building: syncBuildingFromWings(building, translatedWings),
      snapped: false,
    };
  }

  let bestScore = snapTolerance + 0.001;
  let corrX = 0;
  let corrZ = 0;
  let snapGuide: [WorldPoint, WorldPoint] | undefined;

  for (const mw of movingWings) {
    const mfp = mw.footprint;
    if (mfp.length < 3) continue;
    const mMaxR = Math.max(10, ...mfp.map((p) => Math.hypot(p.x - mw.x, p.z - mw.z)));

    for (const target of targetPolys) {
      if (Math.hypot(mw.x - target.cx, mw.z - target.cz) > mMaxR + target.maxR + snapTolerance * 2) {
        continue;
      }

      const tfp = target.fp;

      // 1. Vertex-to-vertex exact snap (strongest tactile lock)
      for (let i = 0; i < mfp.length; i++) {
        const mv = mfp[i];
        for (let j = 0; j < tfp.length; j++) {
          const tv = tfp[j];
          const d = Math.hypot(tv.x - mv.x, tv.z - mv.z);
          if (d <= snapTolerance && d * 0.72 < bestScore) {
            bestScore = d * 0.72;
            corrX = tv.x - mv.x;
            corrZ = tv.z - mv.z;
            const tNext = tfp[(j + 1) % tfp.length];
            snapGuide = [tv, tNext];
          }
        }
      }

      // 2. Parallel edge-to-edge flush snap (0.0 gap wall-to-wall contact!)
      for (let i = 0; i < mfp.length; i++) {
        const ma = mfp[i];
        const mb = mfp[(i + 1) % mfp.length];
        const mdx = mb.x - ma.x;
        const mdz = mb.z - ma.z;
        const mLen = Math.hypot(mdx, mdz);
        if (mLen < 1) continue;
        const mtx = mdx / mLen;
        const mtz = mdz / mLen;

        for (let j = 0; j < tfp.length; j++) {
          const ta = tfp[j];
          const tb = tfp[(j + 1) % tfp.length];
          const tdx = tb.x - ta.x;
          const tdz = tb.z - ta.z;
          const tLen = Math.hypot(tdx, tdz);
          if (tLen < 1) continue;
          const ttx = tdx / tLen;
          const ttz = tdz / tLen;

          // Nearly parallel edges (within ~8°)
          const parallelDot = Math.abs(mtx * ttx + mtz * ttz);
          if (parallelDot < 0.99) continue;

          // Outward-independent unit normal to target edge
          const nx = -ttz;
          const nz = ttx;

          // Project moving edge endpoints onto target edge tangent & normal
          const paT = (ma.x - ta.x) * ttx + (ma.z - ta.z) * ttz;
          const pbT = (mb.x - ta.x) * ttx + (mb.z - ta.z) * ttz;
          const minMT = Math.min(paT, pbT);
          const maxMT = Math.max(paT, pbT);
          if (maxMT < -snapTolerance || minMT > tLen + snapTolerance) continue;

          const midMx = (ma.x + mb.x) * 0.5;
          const midMz = (ma.z + mb.z) * 0.5;
          const signedDistN = (midMx - ta.x) * nx + (midMz - ta.z) * nz;
          const absDistN = Math.abs(signedDistN);
          if (absDistN <= snapTolerance && absDistN * 0.8 < bestScore) {
            bestScore = absDistN * 0.8;
            let shiftT = 0;
            // Bonus corner flush alignment along the edge tangent
            if (Math.abs(minMT - 0) <= snapTolerance * 0.75) shiftT = -minMT;
            else if (Math.abs(maxMT - tLen) <= snapTolerance * 0.75) shiftT = tLen - maxMT;
            else if (Math.abs(maxMT - 0) <= snapTolerance * 0.75) shiftT = -maxMT;
            else if (Math.abs(minMT - tLen) <= snapTolerance * 0.75) shiftT = tLen - minMT;

            corrX = -nx * signedDistN + ttx * shiftT;
            corrZ = -nz * signedDistN + ttz * shiftT;
            snapGuide = [ta, tb];
          }
        }
      }

      // 3. Vertex-to-edge snap (for angled / triangular / freeform wings meeting a wall)
      for (let i = 0; i < mfp.length; i++) {
        const mv = mfp[i];
        for (let j = 0; j < tfp.length; j++) {
          const ta = tfp[j];
          const tb = tfp[(j + 1) % tfp.length];
          const tdx = tb.x - ta.x;
          const tdz = tb.z - ta.z;
          const lenSq = tdx * tdx + tdz * tdz;
          if (lenSq < 1e-4) continue;
          const t = Math.max(0, Math.min(1, ((mv.x - ta.x) * tdx + (mv.z - ta.z) * tdz) / lenSq));
          const px = ta.x + t * tdx;
          const pz = ta.z + t * tdz;
          const d = Math.hypot(px - mv.x, pz - mv.z);
          if (d <= snapTolerance && d < bestScore) {
            bestScore = d;
            corrX = px - mv.x;
            corrZ = pz - mv.z;
            snapGuide = [ta, tb];
          }
        }
      }
    }
  }

  if (snapGuide && (Math.abs(corrX) > 1e-5 || Math.abs(corrZ) > 1e-5 || bestScore <= snapTolerance)) {
    const snappedWings = translatedWings.map((w) => {
      if (moveSingleWing && w.id !== wingId) return w;
      return {
        ...w,
        x: Math.round((w.x + corrX) * 10) / 10,
        z: Math.round((w.z + corrZ) * 10) / 10,
        footprint: w.footprint.map((pt) => ({
          x: Math.round((pt.x + corrX) * 10) / 10,
          z: Math.round((pt.z + corrZ) * 10) / 10,
        })),
      };
    });
    return {
      building: syncBuildingFromWings(building, snappedWings),
      snapped: true,
      snapGuide,
    };
  }

  return {
    building: syncBuildingFromWings(building, translatedWings),
    snapped: false,
  };
}

/**
 * Converts a wing into `'freeform'` polygon sculpting mode so every vertex and edge midpoint
 * can be dragged freely to sculpt arbitrary architectural shapes.
 */
export function convertWingToFreeform(building: Building3D, wingId?: string): Building3D {
  const wings = getBuildingWings(building);
  const targetId = wingId ?? wings[0].id;
  const nextWings = wings.map((w) => {
    if (w.id !== targetId) return w;
    return {
      ...w,
      shapeType: 'freeform' as const,
      skewDeg: undefined,
    };
  });
  return syncBuildingFromWings(building, nextWings);
}

/**
 * Moves a single vertex of a building wing to sculpt an arbitrary shape.
 * Automatically switches the wing's shapeType to `'freeform'` and optionally snaps
 * the vertex to nearby neighbor buildings or sibling wings.
 */
export function moveBuildingWingVertex(
  building: Building3D,
  wingId: string | undefined,
  vertexIdx: number,
  worldPt: WorldPoint,
  neighborBuildings?: Building3D[],
  snapToBuilding = true,
  snapTolerance = 8
): MoveBuildingResult {
  const wings = getBuildingWings(building);
  const targetId = wingId ?? wings[0].id;

  const snapRes =
    snapToBuilding && neighborBuildings && neighborBuildings.length > 0
      ? snapPointToBuildings(worldPt, neighborBuildings, building.id, targetId, snapTolerance)
      : {
          x: Math.round(worldPt.x * 10) / 10,
          z: Math.round(worldPt.z * 10) / 10,
          snapped: false,
          snapKind: 'none' as const,
          snapGuide: undefined,
        };

  const nextWings = wings.map((w) => {
    if (w.id !== targetId) return w;
    if (vertexIdx < 0 || vertexIdx >= w.footprint.length) return w;
    const nextFp = w.footprint.map((pt, idx) =>
      idx === vertexIdx ? { x: snapRes.x, z: snapRes.z } : pt
    );
    const stats = computePolygonCentroidAndDims(nextFp);
    return {
      ...w,
      x: stats.x,
      z: stats.z,
      measuredWidth: Math.max(1, Math.round(stats.width)),
      measuredDepth: Math.max(1, Math.round(stats.depth)),
      shapeType: 'freeform' as const,
      skewDeg: undefined,
      footprint: nextFp,
    };
  });

  return {
    building: syncBuildingFromWings(building, nextWings),
    snapped: snapRes.snapped,
    snapGuide: snapRes.snapGuide,
  };
}

/**
 * Inserts a new sculptable vertex into a wing's footprint polygon right after `afterIdx`.
 */
export function insertBuildingWingVertex(
  building: Building3D,
  wingId: string | undefined,
  afterIdx: number,
  worldPt: WorldPoint
): { building: Building3D; insertedIdx: number } {
  const wings = getBuildingWings(building);
  const targetId = wingId ?? wings[0].id;
  let insertedIdx = afterIdx + 1;

  const nextWings = wings.map((w) => {
    if (w.id !== targetId) return w;
    const fp = [...w.footprint];
    const safeIdx = Math.max(0, Math.min(fp.length - 1, afterIdx)) + 1;
    insertedIdx = safeIdx;
    fp.splice(safeIdx, 0, {
      x: Math.round(worldPt.x * 10) / 10,
      z: Math.round(worldPt.z * 10) / 10,
    });
    const stats = computePolygonCentroidAndDims(fp);
    return {
      ...w,
      x: stats.x,
      z: stats.z,
      measuredWidth: Math.max(1, Math.round(stats.width)),
      measuredDepth: Math.max(1, Math.round(stats.depth)),
      shapeType: 'freeform' as const,
      skewDeg: undefined,
      footprint: fp,
    };
  });

  return {
    building: syncBuildingFromWings(building, nextWings),
    insertedIdx,
  };
}

/**
 * Removes a vertex from a wing's footprint polygon (only when more than 3 vertices remain).
 */
export function removeBuildingWingVertex(
  building: Building3D,
  wingId: string | undefined,
  vertexIdx: number
): Building3D {
  const wings = getBuildingWings(building);
  const targetId = wingId ?? wings[0].id;

  const nextWings = wings.map((w) => {
    if (w.id !== targetId) return w;
    if (w.footprint.length <= 3 || vertexIdx < 0 || vertexIdx >= w.footprint.length) return w;
    const fp = w.footprint.filter((_, idx) => idx !== vertexIdx);
    const stats = computePolygonCentroidAndDims(fp);
    return {
      ...w,
      x: stats.x,
      z: stats.z,
      measuredWidth: Math.max(1, Math.round(stats.width)),
      measuredDepth: Math.max(1, Math.round(stats.depth)),
      shapeType: 'freeform' as const,
      skewDeg: undefined,
      footprint: fp,
    };
  });

  return syncBuildingFromWings(building, nextWings);
}

/**
 * Adds a new architectural wing (корпус) to an existing building, sharing its single address.
 * If `customWing` is omitted, places an adjacent wing seamlessly next to the last wing.
 */
export function addWingToBuilding(
  building: Building3D,
  customWing?: {
    x: number;
    z: number;
    width: number;
    depth: number;
    angleDeg?: number;
    floors?: number;
    height?: number;
    footprint?: WorldPoint[];
    shapeType?: BuildingWing['shapeType'];
    skewDeg?: number;
  }
): { building: Building3D; newWingId: string } {
  const existingWings = getBuildingWings(building);
  const ref = existingWings[existingWings.length - 1];
  const refDims = measureWingDims(ref);
  const nextIdx = existingWings.length + 1;
  const newWingId = `${building.id}-w${Date.now()}-${nextIdx}`;

  let newWing: BuildingWing;
  if (customWing) {
    const angle = normalizeAngleDeg(customWing.angleDeg ?? ref.orientationDeg ?? 0);
    const floors = Math.max(1, customWing.floors ?? ref.floors);
    const height =
      customWing.height !== undefined
        ? Math.max(2, Math.round(customWing.height))
        : customWing.floors === undefined || customWing.floors === ref.floors
        ? ref.height
        : Math.round(floors * 4.2 + 3);
    const baseY = ref.baseY ?? building.baseY ?? SERVER_GROUND_Y;
    const w = Math.max(1, Math.round(customWing.width));
    const d = Math.max(1, Math.round(customWing.depth));
    newWing = {
      id: newWingId,
      label: `Корпус ${nextIdx}`,
      x: Math.round(customWing.x * 10) / 10,
      z: Math.round(customWing.z * 10) / 10,
      footprint: customWing.footprint
        ? ensureClockwiseFootprint(customWing.footprint)
        : createRectFootprint(customWing.x, customWing.z, w, d, angle),
      height,
      floors,
      baseY,
      roofY: baseY + height,
      roofType: ref.roofType ?? 'flat',
      shapeType: customWing.shapeType,
      measuredWidth: w,
      measuredDepth: d,
      orientationDeg: angle,
      skewDeg: customWing.skewDeg,
    };
  } else {
    // Spawn an adjacent L-wing or side-wing aligned with the reference wing's orientation at the SAME height
    const angle = ref.orientationDeg ?? 0;
    const rad = (angle * Math.PI) / 180;
    const w = Math.max(12, Math.round(refDims.width * 0.65));
    const d = Math.max(12, Math.round(refDims.depth * 0.85));
    // Place flush touching the right edge (along local +u axis)
    const offsetU = (refDims.width + w) * 0.5;
    const offsetV = (refDims.depth - d) * 0.5;
    const nx = Math.round(ref.x + offsetU * Math.cos(rad) - offsetV * Math.sin(rad));
    const nz = Math.round(ref.z + offsetU * Math.sin(rad) + offsetV * Math.cos(rad));
    const baseY = ref.baseY ?? building.baseY ?? SERVER_GROUND_Y;
    const floors = Math.max(1, ref.floors);
    const height = ref.height;

    newWing = {
      id: newWingId,
      label: `Корпус ${nextIdx}`,
      x: nx,
      z: nz,
      footprint: createRectFootprint(nx, nz, w, d, angle),
      height,
      floors,
      baseY,
      roofY: baseY + height,
      roofType: ref.roofType ?? 'flat',
      measuredWidth: w,
      measuredDepth: d,
      orientationDeg: angle,
    };
  }

  return {
    building: syncBuildingFromWings(building, [...existingWings, newWing]),
    newWingId,
  };
}

/**
 * Removes a wing (корпус) from a multi-wing building. Will not remove the last remaining wing.
 */
export function removeWingFromBuilding(
  building: Building3D,
  wingId: string
): { building: Building3D; removed: boolean; nextActiveWingId: string } {
  const wings = getBuildingWings(building);
  if (wings.length <= 1) {
    return { building, removed: false, nextActiveWingId: wings[0]?.id ?? '' };
  }
  const remaining = wings.filter((w) => w.id !== wingId);
  if (remaining.length === wings.length || remaining.length === 0) {
    return { building, removed: false, nextActiveWingId: wings[0].id };
  }
  const updated = syncBuildingFromWings(building, remaining);
  const updatedWings = getBuildingWings(updated);
  return {
    building: updated,
    removed: true,
    nextActiveWingId: updatedWings[0].id,
  };
}

/**
 * Merges a secondary building (and all its wings) into a primary building under one unified address.
 */
export function mergeBuildings(primary: Building3D, secondary: Building3D): Building3D {
  if (primary.id === secondary.id) return primary;
  const primaryWings = getBuildingWings(primary);
  const secondaryWings = getBuildingWings(secondary).map((w, idx) => ({
    ...w,
    id: `${primary.id}-m-${Date.now()}-${idx}`,
    label: `Корпус ${primaryWings.length + idx + 1}`,
  }));

  return syncBuildingFromWings(primary, [...primaryWings, ...secondaryWings]);
}

/**
 * Merges 2 or more selected buildings into `buildingsToMerge[0]` under one unified address,
 * preserving every architectural wing with sequential `Корпус N` labels.
 */
export function mergeMultipleBuildings(buildingsToMerge: Building3D[]): Building3D {
  if (buildingsToMerge.length === 0) {
    throw new Error('mergeMultipleBuildings requires at least 1 building');
  }
  const primary = buildingsToMerge[0];
  if (buildingsToMerge.length === 1) return primary;

  const stamp = Date.now();
  const seenIds = new Set<string>([primary.id]);
  const combinedWings: BuildingWing[] = [...getBuildingWings(primary)];

  for (let bIdx = 1; bIdx < buildingsToMerge.length; bIdx++) {
    const sec = buildingsToMerge[bIdx];
    if (!sec || seenIds.has(sec.id)) continue;
    seenIds.add(sec.id);
    const secWings = getBuildingWings(sec);
    for (let wIdx = 0; wIdx < secWings.length; wIdx++) {
      combinedWings.push({
        ...secWings[wIdx],
        id: `${primary.id}-mm-${stamp}-${bIdx}-${wIdx}`,
        label: `Корпус ${combinedWings.length + 1}`,
      });
    }
  }

  return syncBuildingFromWings(primary, combinedWings);
}

/**
 * Splits a building into separate independent buildings:
 * - If the building has multiple wings (корпуса), detaches each wing into its own Building3D.
 * - If the building is a single rectangular volume, cleanly bisects it along its longer local axis into 2 buildings.
 */
export function splitBuilding(building: Building3D): Building3D[] {
  const wings = getBuildingWings(building);

  if (wings.length >= 2) {
    return wings.map((w, idx) => ({
      ...building,
      id: idx === 0 ? building.id : `user-b-split-${Date.now()}-${idx}`,
      name: idx === 0 ? building.name : `${building.name} (${w.label || `к.${idx + 1}`})`,
      houseNumber: idx === 0 ? building.houseNumber : `${building.houseNumber}к${idx + 1}`,
      x: w.x,
      z: w.z,
      footprint: w.footprint,
      height: w.height,
      floors: w.floors,
      baseY: w.baseY ?? building.baseY ?? SERVER_GROUND_Y,
      roofY: w.roofY ?? (w.baseY ?? building.baseY ?? SERVER_GROUND_Y) + w.height,
      roofType: w.roofType ?? building.roofType ?? 'flat',
      shapeType: w.shapeType ?? building.shapeType,
      measuredWidth: w.measuredWidth,
      measuredDepth: w.measuredDepth,
      orientationDeg: w.orientationDeg ?? 0,
      skewDeg: w.skewDeg,
      wings: undefined,
      isUserEdited: true,
    }));
  }

  // Bisect single building along its longer local axis
  const w0 = wings[0];
  const dims = measureWingDims(w0);
  const angle = w0.orientationDeg ?? 0;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const splitAlongWidth = dims.width >= dims.depth;
  const gap = Math.min(2, Math.max(0.5, (splitAlongWidth ? dims.width : dims.depth) * 0.1));
  const halfW = splitAlongWidth ? Math.max(1, Math.round((dims.width - gap) * 0.5)) : dims.width;
  const halfD = splitAlongWidth ? dims.depth : Math.max(1, Math.round((dims.depth - gap) * 0.5));

  const shiftU = splitAlongWidth ? (halfW + gap) * 0.5 : 0;
  const shiftV = splitAlongWidth ? 0 : (halfD + gap) * 0.5;

  const c1x = Math.round(w0.x - shiftU * cos + shiftV * sin);
  const c1z = Math.round(w0.z - shiftU * sin - shiftV * cos);
  const c2x = Math.round(w0.x + shiftU * cos - shiftV * sin);
  const c2z = Math.round(w0.z + shiftU * sin + shiftV * cos);

  const b1: Building3D = {
    ...building,
    x: c1x,
    z: c1z,
    footprint: createRectFootprint(c1x, c1z, halfW, halfD, angle),
    measuredWidth: halfW,
    measuredDepth: halfD,
    orientationDeg: angle,
    wings: undefined,
    isUserEdited: true,
  };

  const b2: Building3D = {
    ...building,
    id: `user-b-split-${Date.now()}-2`,
    name: `${building.name} (часть 2)`,
    houseNumber: `${building.houseNumber}А`,
    x: c2x,
    z: c2z,
    footprint: createRectFootprint(c2x, c2z, halfW, halfD, angle),
    measuredWidth: halfW,
    measuredDepth: halfD,
    orientationDeg: angle,
    wings: undefined,
    isUserEdited: true,
  };

  return [b1, b2];
}

// ---------------------------------------------------------------------------
// Seamless Same-Height Attached Wing Boundary Removal & Visual Center Anchor
// ---------------------------------------------------------------------------

export interface ExposedWingEdge {
  a: WorldPoint;
  b: WorldPoint;
  /** Outward unit normal in world X,Z */
  outNx: number;
  outNz: number;
}

export interface BuildingLabelAnchor {
  x: number;
  z: number;
  maxRadius: number;
  wingId: string;
  baseY: number;
  height: number;
  roofY: number;
}

function pointInWorldPolygon(px: number, pz: number, poly: WorldPoint[]): boolean {
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

export function clipFootprintEdgesAgainstOccluders(
  footprint: WorldPoint[],
  occluders: WorldPoint[][],
  eps = 0.45
): ExposedWingEdge[] {
  const n = footprint.length;
  if (n < 3) return [];

  const signedArea = computeFootprintSignedArea(footprint);
  // In (X-right, Z-down), CW polygon has signedArea > 0 and outward normal of (dx, dz) is (dz, -dx)
  const normalSign = signedArea >= 0 ? 1 : -1;

  if (occluders.length === 0) {
    const all: ExposedWingEdge[] = [];
    for (let i = 0; i < n; i++) {
      const a = footprint[i];
      const b = footprint[(i + 1) % n];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      all.push({
        a,
        b,
        outNx: (dz / len) * normalSign,
        outNz: (-dx / len) * normalSign,
      });
    }
    return all;
  }

  const exposed: ExposedWingEdge[] = [];

  for (let i = 0; i < n; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const lenSq = len * len;
    const outNx = (dz / len) * normalSign;
    const outNz = (-dx / len) * normalSign;

    const splits: number[] = [0, 1];

    for (let pIdx = 0; pIdx < occluders.length; pIdx++) {
      const poly = occluders[pIdx];
      const m = poly.length;
      if (m < 3) continue;

      for (let j = 0; j < m; j++) {
        const c = poly[j];
        const d = poly[(j + 1) % m];

        // 1. Project occluder vertex onto AB if it is close to AB (handles T-joints & flush touching!)
        const projT = ((c.x - a.x) * dx + (c.z - a.z) * dz) / lenSq;
        if (projT > 0.001 && projT < 0.999) {
          const px = a.x + projT * dx;
          const pz = a.z + projT * dz;
          if (Math.hypot(c.x - px, c.z - pz) <= eps * 1.6) {
            splits.push(projT);
          }
        }

        // 2. Proper segment-segment intersection between AB and CD (handles overlapping wings!)
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

    for (let k = 0; k < uniqueSplits.length - 1; k++) {
      const t0 = uniqueSplits[k];
      const t1 = uniqueSplits[k + 1];
      if ((t1 - t0) * len < 0.08) continue;

      const tm = (t0 + t1) * 0.5;
      const mx = a.x + tm * dx;
      const mz = a.z + tm * dz;
      // Probe slightly outward from this wing's edge:
      // If a same-height sibling wing occupies the space right outside this edge (touching flush
      // or overlapping), then this edge is an INTERNAL seam and must be removed!
      const probeOutX = mx + outNx * eps;
      const probeOutZ = mz + outNz * eps;

      let hiddenBySibling = false;
      for (let pIdx = 0; pIdx < occluders.length; pIdx++) {
        const poly = occluders[pIdx];
        if (pointInWorldPolygon(probeOutX, probeOutZ, poly)) {
          hiddenBySibling = true;
          break;
        }
        // Also hide edges strictly inside an overlapping sibling polygon
        if (pointInWorldPolygon(mx, mz, poly)) {
          let onPolyEdge = false;
          for (let j = 0; j < poly.length; j++) {
            const c = poly[j];
            const d = poly[(j + 1) % poly.length];
            if (pointToSegmentDistance(mx, mz, c.x, c.z, d.x, d.z) <= eps * 0.6) {
              onPolyEdge = true;
              break;
            }
          }
          if (!onPolyEdge) {
            hiddenBySibling = true;
            break;
          }
        }
      }

      if (!hiddenBySibling) {
        exposed.push({
          a: { x: a.x + t0 * dx, z: a.z + t0 * dz },
          b: { x: a.x + t1 * dx, z: a.z + t1 * dz },
          outNx,
          outNz,
        });
      }
    }
  }

  return exposed;
}

/**
 * Computes the exterior (visible) roof boundary edges and 3D vertical wall edges for a wing
 * within a multi-wing building:
 * - Removes shared/overlapping roof border segments between attached wings of the SAME height
 *   (`|Δheight| <= 1.2` and `|ΔbaseY| <= 1.2`) so attached same-height корпуса visually merge into one clean outline.
 * - Preserves crisp step boundaries between wings of DIFFERENT heights.
 * - Removes hidden internal 3D side walls occluded by an equal-or-taller attached sibling wing.
 */
export function computeWingExposedEdges(
  wing: BuildingWing,
  allWings: BuildingWing[],
  buildingBaseY = SERVER_GROUND_Y
): {
  exposedRoofEdges: ExposedWingEdge[];
  exposedWallEdges: ExposedWingEdge[];
} {
  if (allWings.length <= 1) {
    const edges = clipFootprintEdgesAgainstOccluders(wing.footprint, []);
    return { exposedRoofEdges: edges, exposedWallEdges: edges };
  }

  const wBaseY = wing.baseY ?? buildingBaseY;
  const wRoofY = wBaseY + wing.height;

  const sameHeightPolys: WorldPoint[][] = [];
  const wallOccluderPolys: WorldPoint[][] = [];

  for (let i = 0; i < allWings.length; i++) {
    const sib = allWings[i];
    if (sib.id === wing.id || !sib.footprint || sib.footprint.length < 3) continue;
    const sBaseY = sib.baseY ?? buildingBaseY;
    const sRoofY = sBaseY + sib.height;

    const sameHeight = Math.abs(sib.height - wing.height) <= 1.2 && Math.abs(sBaseY - wBaseY) <= 1.2;
    if (sameHeight) {
      sameHeightPolys.push(sib.footprint);
    }
    if (sRoofY >= wRoofY - 1.2 && sBaseY <= wBaseY + 1.2) {
      wallOccluderPolys.push(sib.footprint);
    }
  }

  const exposedRoofEdges = clipFootprintEdgesAgainstOccluders(wing.footprint, sameHeightPolys);
  const exposedWallEdges =
    wallOccluderPolys.length === sameHeightPolys.length
      ? exposedRoofEdges
      : clipFootprintEdgesAgainstOccluders(wing.footprint, wallOccluderPolys);

  return { exposedRoofEdges, exposedWallEdges };
}

/**
 * Computes the true visual interior center (Pole of Inaccessibility / Polylabel) of a building
 * strictly INSIDE its footprint boundaries (accounting for concave L/U/П/freeform courtyards,
 * corner triangles, and multi-wing complexes with merged same-height interiors).
 */
export function computeBuildingLabelAnchor(building: Building3D): BuildingLabelAnchor {
  const wings = getBuildingWings(building).filter((w) => w.footprint && w.footprint.length >= 3);
  const bBaseY = building.baseY ?? SERVER_GROUND_Y;

  if (wings.length === 0) {
    return {
      x: building.x,
      z: building.z,
      maxRadius: 4,
      wingId: `${building.id}-w1`,
      baseY: bBaseY,
      height: building.height,
      roofY: bBaseY + building.height,
    };
  }

  // Fast exact path for single simple convex 4-gon / circle (centroid is already exact visual center!)
  if (
    wings.length === 1 &&
    wings[0].shapeType !== 'freeform' &&
    wings[0].shapeType !== 'triangular' &&
    wings[0].footprint.length !== 3
  ) {
    const w0 = wings[0];
    if (pointInWorldPolygon(w0.x, w0.z, w0.footprint)) {
      let minEdgeD = Infinity;
      const fp = w0.footprint;
      for (let i = 0; i < fp.length; i++) {
        const a = fp[i];
        const b = fp[(i + 1) % fp.length];
        const d = pointToSegmentDistance(w0.x, w0.z, a.x, a.z, b.x, b.z);
        if (d < minEdgeD) minEdgeD = d;
      }
      const wBaseY = w0.baseY ?? bBaseY;
      return {
        x: w0.x,
        z: w0.z,
        maxRadius: Number.isFinite(minEdgeD) ? minEdgeD : 4,
        wingId: w0.id,
        baseY: wBaseY,
        height: w0.height,
        roofY: wBaseY + w0.height,
      };
    }
  }

  // Exact analytical incenter for a single triangle!
  if (wings.length === 1 && wings[0].footprint.length === 3) {
    const w0 = wings[0];
    const [p0, p1, p2] = w0.footprint;
    const aLen = Math.hypot(p1.x - p2.x, p1.z - p2.z);
    const bLen = Math.hypot(p0.x - p2.x, p0.z - p2.z);
    const cLen = Math.hypot(p0.x - p1.x, p0.z - p1.z);
    const perim = aLen + bLen + cLen;
    if (perim > 1e-4) {
      const ix = (aLen * p0.x + bLen * p1.x + cLen * p2.x) / perim;
      const iz = (aLen * p0.z + bLen * p1.z + cLen * p2.z) / perim;
      const area = Math.abs(computeFootprintSignedArea(w0.footprint));
      const inRadius = (2 * area) / perim;
      const wBaseY = w0.baseY ?? bBaseY;
      return {
        x: Math.round(ix * 10) / 10,
        z: Math.round(iz * 10) / 10,
        maxRadius: inRadius,
        wingId: w0.id,
        baseY: wBaseY,
        height: w0.height,
        roofY: wBaseY + w0.height,
      };
    }
  }

  // General Polylabel over the union of all wings (treating merged same-height wings as continuous interior!)
  const outerEdges: Array<{ a: WorldPoint; b: WorldPoint }> = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < wings.length; i++) {
    const w = wings[i];
    for (let k = 0; k < w.footprint.length; k++) {
      const pt = w.footprint[k];
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }
    // Use exterior boundary of the full building union (clip against ALL sibling wings)
    const siblingPolys = wings.filter((s) => s.id !== w.id).map((s) => s.footprint);
    const ext = clipFootprintEdgesAgainstOccluders(w.footprint, siblingPolys);
    for (let e = 0; e < ext.length; e++) {
      outerEdges.push({ a: ext[e].a, b: ext[e].b });
    }
  }

  // Fallback if all edges were clipped (e.g. duplicate overlapping footprints)
  if (outerEdges.length === 0) {
    const fp = wings[0].footprint;
    for (let i = 0; i < fp.length; i++) {
      outerEdges.push({ a: fp[i], b: fp[(i + 1) % fp.length] });
    }
  }

  const findContainingWing = (px: number, pz: number): BuildingWing | null => {
    let bestW: BuildingWing | null = null;
    for (let i = 0; i < wings.length; i++) {
      const w = wings[i];
      if (pointInWorldPolygon(px, pz, w.footprint)) {
        if (!bestW || w.height > bestW.height) {
          bestW = w;
        }
      }
    }
    return bestW;
  };

  const signedDist = (px: number, pz: number): { d: number; wing: BuildingWing | null } => {
    const wing = findContainingWing(px, pz);
    let minD = Infinity;
    for (let i = 0; i < outerEdges.length; i++) {
      const e = outerEdges[i];
      const d = pointToSegmentDistance(px, pz, e.a.x, e.a.z, e.b.x, e.b.z);
      if (d < minD) minD = d;
    }
    if (!Number.isFinite(minD)) minD = 0;
    return { d: wing ? minD : -minD, wing };
  };

  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const precision = Math.max(0.35, Math.min(spanX, spanZ) * 0.015);
  const SQRT2 = Math.SQRT2;

  let bestX = wings[0].x;
  let bestZ = wings[0].z;
  let bestD = -Infinity;
  let bestWing: BuildingWing = wings[0];

  const tryCandidate = (cx: number, cz: number) => {
    const res = signedDist(cx, cz);
    if (res.wing && res.d > bestD) {
      bestD = res.d;
      bestX = cx;
      bestZ = cz;
      bestWing = res.wing;
    }
  };

  // Seed with overall area-weighted centroid and every individual wing's centroid
  let totalArea = 0;
  let weightedX = 0;
  let weightedZ = 0;
  for (let i = 0; i < wings.length; i++) {
    const st = computePolygonCentroidAndDims(wings[i].footprint);
    const area = Math.max(1, st.area);
    totalArea += area;
    weightedX += st.x * area;
    weightedZ += st.z * area;
    tryCandidate(st.x, st.z);
    tryCandidate(wings[i].x, wings[i].z);
  }
  if (totalArea > 0) {
    tryCandidate(weightedX / totalArea, weightedZ / totalArea);
  }

  // Hierarchical Polylabel grid search
  interface Cell {
    x: number;
    z: number;
    h: number;
    d: number;
    max: number;
  }
  const queue: Cell[] = [];
  const makeCell = (x: number, z: number, h: number): Cell => {
    const res = signedDist(x, z);
    if (res.wing && res.d > bestD) {
      bestD = res.d;
      bestX = x;
      bestZ = z;
      bestWing = res.wing;
    }
    return { x, z, h, d: res.d, max: res.d + h * SQRT2 };
  };

  const initCellSize = Math.max(spanX, spanZ) / 6;
  const initH = initCellSize * 0.5;
  for (let x = minX; x < maxX; x += initCellSize) {
    for (let z = minZ; z < maxZ; z += initCellSize) {
      queue.push(makeCell(x + initH, z + initH, initH));
    }
  }

  let iter = 0;
  while (queue.length > 0 && iter < 56) {
    iter++;
    // Pop cell with highest max potential
    let maxIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].max > queue[maxIdx].max) maxIdx = i;
    }
    const cell = queue[maxIdx];
    queue[maxIdx] = queue[queue.length - 1];
    queue.pop();

    if (cell.max - bestD <= precision) continue;

    const nh = cell.h * 0.5;
    if (nh < precision * 0.5) continue;
    queue.push(makeCell(cell.x - nh, cell.z - nh, nh));
    queue.push(makeCell(cell.x + nh, cell.z - nh, nh));
    queue.push(makeCell(cell.x - nh, cell.z + nh, nh));
    queue.push(makeCell(cell.x + nh, cell.z + nh, nh));
  }

  const wBaseY = bestWing.baseY ?? bBaseY;
  return {
    x: Math.round(bestX * 10) / 10,
    z: Math.round(bestZ * 10) / 10,
    maxRadius: Math.max(0, bestD),
    wingId: bestWing.id,
    baseY: wBaseY,
    height: bestWing.height,
    roofY: wBaseY + bestWing.height,
  };
}

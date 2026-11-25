import type { Building3D, CameraState, StreetSegment, WorldPoint } from '../types/map';

export interface ProjectedPoint {
  sx: number;
  sy: number;
  depth: number;
  scale: number;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Projects a Minecraft world coordinate (x, z, elevationY) to 2D canvas screen coordinates
 * using Yandex Maps-style 2.5D tilted perspective projection.
 * Pitch = 0 -> flat orthographic top-down map.
 * Pitch = 48 -> tilted 3D view with subtle perspective foreshortening and vertical building extrusion.
 */
export function worldToScreen(
  worldX: number,
  worldZ: number,
  elevation: number,
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number
): ProjectedPoint {
  const dx = worldX - camera.x;
  const dz = worldZ - camera.z;

  const radBearing = -camera.bearing * DEG_TO_RAD;
  const cosB = Math.cos(radBearing);
  const sinB = Math.sin(radBearing);

  // Rotated world offsets relative to camera center
  const rx = dx * cosB - dz * sinB;
  const rz = dx * sinB + dz * cosB;

  const pitchRad = Math.max(0, Math.min(60, camera.pitch)) * DEG_TO_RAD;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);

  // Subtle perspective depth factor when tilted
  const baseScreenY = rz * camera.zoom * cosP;
  const perspectiveStrength = sinP * 0.00055;
  const denom = Math.max(0.32, 1 - baseScreenY * perspectiveStrength);
  const scale = 1 / denom;

  const sx = viewportWidth * 0.5 + rx * camera.zoom * scale;
  const groundSy = viewportHeight * 0.5 + baseScreenY * scale;

  // Vertical extrusion rises upward on screen proportional to sin(pitch)
  // In 2D (pitch = 0), elevation offset is 0.
  const heightPx = elevation * camera.zoom * sinP * 1.15 * scale;
  const sy = groundSy - heightPx;

  return {
    sx,
    sy,
    depth: rz,
    scale,
  };
}

/**
 * Inverse projection from screen coordinates (sx, sy) onto the ground plane (elevation = 0).
 */
export function screenToWorld(
  sx: number,
  sy: number,
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number
): WorldPoint {
  const pitchRad = Math.max(0, Math.min(60, camera.pitch)) * DEG_TO_RAD;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);

  const offsetX = sx - viewportWidth * 0.5;
  const offsetY = sy - viewportHeight * 0.5;

  const perspectiveStrength = sinP * 0.00055;
  // Since offsetY = baseScreenY / (1 - baseScreenY * p), solve for baseScreenY:
  // baseScreenY = offsetY / (1 + offsetY * p)
  const invDenom = Math.max(0.25, 1 + offsetY * perspectiveStrength);
  const baseScreenY = offsetY / invDenom;
  const scale = 1 / Math.max(0.32, 1 - baseScreenY * perspectiveStrength);

  const rz = baseScreenY / Math.max(1e-6, camera.zoom * cosP);
  const rx = offsetX / Math.max(1e-6, camera.zoom * scale);

  const radBearing = camera.bearing * DEG_TO_RAD;
  const cosB = Math.cos(radBearing);
  const sinB = Math.sin(radBearing);

  const dx = rx * cosB - rz * sinB;
  const dz = rx * sinB + rz * cosB;

  return {
    x: camera.x + dx,
    z: camera.z + dz,
  };
}

/**
 * Ray-casting point-in-polygon check in 2D screen or world space.
 */
export function pointInPolygon(px: number, py: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Distance from point P to line segment AB.
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Hit-tests extruded 3D buildings (including complex multi-wing skyscrapers, nested spires,
 * and elevated wings) in screen space using exact 2.5D ray surface elevation/depth comparison,
 * returning both the matched building and wing id.
 */
export function hitTestBuildingWithWing(
  sx: number,
  sy: number,
  buildings: Building3D[],
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  useElevY = false
): { building: Building3D; wingId: string } | null {
  const is3D = camera.pitch > 0.5;
  const GROUND_Y = 64;

  let bestMatch: { building: Building3D; wingId: string } | null = null;
  let bestScoreY = -Infinity;
  let bestScoreDepth = -Infinity;

  const tryRecordHit = (
    building: Building3D,
    wingId: string,
    hitElev: number,
    hitDepth: number
  ) => {
    if (
      hitElev > bestScoreY + 0.05 ||
      (Math.abs(hitElev - bestScoreY) <= 0.05 && hitDepth > bestScoreDepth)
    ) {
      bestScoreY = hitElev;
      bestScoreDepth = hitDepth;
      bestMatch = { building, wingId };
    }
  };

  const testWing = (
    b: Building3D,
    wingId: string,
    footprint: WorldPoint[],
    height: number,
    rawBaseY: number
  ) => {
    const n = footprint.length;
    if (n < 3) return;
    const baseElev = is3D && useElevY ? Math.max(-18, rawBaseY - GROUND_Y) : 0;
    const roofElev = is3D ? baseElev + Math.max(0, height) : 0;

    const basePts: ProjectedPoint[] = new Array(n);
    const roofPts: ProjectedPoint[] = new Array(n);
    let minSx = Infinity;
    let maxSx = -Infinity;
    let minSy = Infinity;
    let maxSy = -Infinity;

    for (let k = 0; k < n; k++) {
      const pt = footprint[k];
      const bp = worldToScreen(pt.x, pt.z, baseElev, camera, viewportWidth, viewportHeight);
      const rp = is3D
        ? worldToScreen(pt.x, pt.z, roofElev, camera, viewportWidth, viewportHeight)
        : bp;
      basePts[k] = bp;
      roofPts[k] = rp;
      if (bp.sx < minSx) minSx = bp.sx;
      if (bp.sx > maxSx) maxSx = bp.sx;
      if (rp.sx < minSx) minSx = rp.sx;
      if (rp.sx > maxSx) maxSx = rp.sx;
      if (bp.sy < minSy) minSy = bp.sy;
      if (bp.sy > maxSy) maxSy = bp.sy;
      if (rp.sy < minSy) minSy = rp.sy;
      if (rp.sy > maxSy) maxSy = rp.sy;
    }

    if (sx < minSx - 1 || sx > maxSx + 1 || sy < minSy - 1 || sy > maxSy + 1) {
      return;
    }

    // 1. Roof polygon hit (exact surface elevation = roofElev)
    const roofPoly = roofPts.map((p) => ({ x: p.sx, y: p.sy }));
    if (pointInPolygon(sx, sy, roofPoly)) {
      let avgDepth = 0;
      for (let k = 0; k < n; k++) avgDepth += roofPts[k].depth;
      avgDepth /= n;
      // In 2D flat mode (pitch <= 0.5), prefer taller wing on overlap
      const flatScoreElev = is3D ? roofElev : (rawBaseY - GROUND_Y) + height;
      tryRecordHit(b, wingId, flatScoreElev, avgDepth);
    }

    // 2. Front-facing vertical extruded wall quads (interpolating exact elevation & depth at pixel)
    if (is3D && roofElev > baseElev + 0.05) {
      let signedArea2 = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        signedArea2 += basePts[i].sx * basePts[j].sy - basePts[j].sx * basePts[i].sy;
      }
      const isCW = signedArea2 >= 0;

      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const b1 = basePts[i];
        const b2 = basePts[j];
        const edgeDx = b2.sx - b1.sx;
        const edgeLen = Math.hypot(edgeDx, b2.sy - b1.sy);
        if (edgeLen < 0.05) continue;
        const outwardNy = isCW ? -edgeDx : edgeDx;
        if (outwardNy <= -0.02 * edgeLen) continue;

        const r1 = roofPts[i];
        const r2 = roofPts[j];
        const quad = [
          { x: b1.sx, y: b1.sy },
          { x: b2.sx, y: b2.sy },
          { x: r2.sx, y: r2.sy },
          { x: r1.sx, y: r1.sy },
        ];
        if (pointInPolygon(sx, sy, quad)) {
          const tHoriz =
            Math.abs(edgeDx) > 1e-3
              ? Math.max(0, Math.min(1, (sx - b1.sx) / edgeDx))
              : 0.5;
          const baseSyAtX = b1.sy + (b2.sy - b1.sy) * tHoriz;
          const roofSyAtX = r1.sy + (r2.sy - r1.sy) * tHoriz;
          const spanY = baseSyAtX - roofSyAtX;
          const tVert =
            Math.abs(spanY) > 1e-3
              ? Math.max(0, Math.min(1, (baseSyAtX - sy) / spanY))
              : 0.5;
          const hitElev = baseElev + (roofElev - baseElev) * tVert;
          const hitDepth = b1.depth + (b2.depth - b1.depth) * tHoriz;
          tryRecordHit(b, wingId, hitElev, hitDepth);
        }
      }
    }

    // 3. Base footprint fallback (e.g. clicking base rim in low-pitch views)
    if (is3D) {
      const basePoly = basePts.map((p) => ({ x: p.sx, y: p.sy }));
      if (pointInPolygon(sx, sy, basePoly)) {
        let avgDepth = 0;
        for (let k = 0; k < n; k++) avgDepth += basePts[k].depth;
        avgDepth /= n;
        tryRecordHit(b, wingId, baseElev, avgDepth);
      }
    }
  };

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.wings && b.wings.length > 0) {
      for (let w = 0; w < b.wings.length; w++) {
        const wing = b.wings[w];
        testWing(b, wing.id, wing.footprint, wing.height, wing.baseY ?? b.baseY ?? GROUND_Y);
      }
    } else {
      testWing(b, `${b.id}-w1`, b.footprint, b.height, b.baseY ?? GROUND_Y);
    }
  }

  return bestMatch;
}

/**
 * Hit-tests extruded 3D buildings in screen space (front-to-back by exact 2.5D surface depth),
 * checking roofs, extruded walls, and base footprints so clicking complex 3D buildings feels accurate.
 */
export function hitTestBuilding(
  sx: number,
  sy: number,
  buildings: Building3D[],
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  useElevY = false
): Building3D | null {
  return (
    hitTestBuildingWithWing(
      sx,
      sy,
      buildings,
      camera,
      viewportWidth,
      viewportHeight,
      useElevY
    )?.building ?? null
  );
}

/**
 * Hit-tests streets in world space within a pixel tolerance converted to blocks.
 */
export function hitTestStreet(
  worldPt: WorldPoint,
  streets: StreetSegment[],
  toleranceBlocks: number
): StreetSegment | null {
  let best: StreetSegment | null = null;
  let bestDist = Infinity;

  for (const street of streets) {
    const halfWidth = Math.max(street.width * 0.5, toleranceBlocks);
    for (let i = 0; i < street.points.length - 1; i++) {
      const a = street.points[i];
      const b = street.points[i + 1];
      const d = pointToSegmentDistance(worldPt.x, worldPt.z, a.x, a.z, b.x, b.z);
      if (d <= halfWidth && d < bestDist) {
        bestDist = d;
        best = street;
      }
    }
  }
  return best;
}

/**
 * Generates a rectangular building footprint centered at (x, z) with given width, depth, and angle.
 */
export function createRectFootprint(
  x: number,
  z: number,
  width: number,
  depth: number,
  angleDeg = 0
): WorldPoint[] {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const rad = angleDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const corners: Array<[number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];

  return corners.map(([cx, cz]) => ({
    x: Math.round((x + cx * cos - cz * sin) * 10) / 10,
    z: Math.round((z + cx * sin + cz * cos) * 10) / 10,
  }));
}

/**
 * Generates a smooth circular or elliptical building footprint centered at (x, z)
 * with diameters (width, depth), optional rotation angleDeg, and N polygon vertices.
 */
export function createCircleFootprint(
  x: number,
  z: number,
  width: number,
  depth: number,
  angleDeg = 0,
  segments = 20
): WorldPoint[] {
  const rx = Math.max(0.5, width * 0.5);
  const ry = Math.max(0.5, depth * 0.5);
  const rad = angleDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const count = Math.max(12, Math.min(36, Math.round(segments)));
  const pts: WorldPoint[] = [];

  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    const lx = Math.cos(theta) * rx;
    const lz = Math.sin(theta) * ry;
    pts.push({
      x: Math.round((x + lx * cos - lz * sin) * 10) / 10,
      z: Math.round((z + lx * sin + lz * cos) * 10) / 10,
    });
  }
  return pts;
}

/**
 * Generates a right-angled triangular (corner) building footprint inscribed in a
 * (width × depth) bounding box centered at (x, z), rotated by angleDeg.
 * `corner` selects which of the 4 bounding-box corners holds the 90° right angle:
 *   0 = NW (-hw, -hd) -> hypotenuse faces SE
 *   1 = NE (+hw, -hd) -> hypotenuse faces SW
 *   2 = SE (+hw, +hd) -> hypotenuse faces NW
 *   3 = SW (-hw, +hd) -> hypotenuse faces NE
 */
export function createTriangleFootprint(
  x: number,
  z: number,
  width: number,
  depth: number,
  angleDeg = 0,
  corner: 0 | 1 | 2 | 3 = 0
): WorldPoint[] {
  const hw = Math.max(0.5, width * 0.5);
  const hd = Math.max(0.5, depth * 0.5);
  const rad = angleDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Ordered clockwise in local (x, z) so 3D wall winding & backface culling match rectangles
  const allBoxCorners: Array<[number, number]> = [
    [-hw, -hd], // 0: NW
    [hw, -hd],  // 1: NE
    [hw, hd],   // 2: SE
    [-hw, hd],  // 3: SW
  ];
  // Drop the opposite corner (corner + 2) % 4 to form the crisp right triangle
  const dropIdx = (corner + 2) % 4;
  const triLocal = allBoxCorners.filter((_, idx) => idx !== dropIdx);

  return triLocal.map(([lx, lz]) => ({
    x: Math.round((x + lx * cos - lz * sin) * 10) / 10,
    z: Math.round((z + lx * sin + lz * cos) * 10) / 10,
  }));
}

/**
 * Generates a skewed parallelogram (oblique parallelepiped base) footprint centered at (x, z)
 * with base width, perpendicular depth, rotation angleDeg, and oblique shear skewDeg (-60..60°).
 * Vertices are ordered clockwise matching createRectFootprint for 3D wall extrusion.
 */
export function createParallelogramFootprint(
  x: number,
  z: number,
  width: number,
  depth: number,
  angleDeg = 0,
  skewDeg = 25
): WorldPoint[] {
  const hw = Math.max(0.5, width * 0.5);
  const hd = Math.max(0.5, depth * 0.5);
  const clampedSkew = Math.max(-60, Math.min(60, skewDeg));
  const shift = Math.tan(clampedSkew * DEG_TO_RAD) * hd;
  const rad = angleDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const corners: Array<[number, number]> = [
    [-hw + shift, -hd],
    [hw + shift, -hd],
    [hw - shift, hd],
    [-hw - shift, hd],
  ];

  return corners.map(([cx, cz]) => ({
    x: Math.round((x + cx * cos - cz * sin) * 10) / 10,
    z: Math.round((z + cx * sin + cz * cos) * 10) / 10,
  }));
}

export function buildBlueMapUrl(x: number, z: number, y = 72, distance = 320): string {
  return `https://bluemap.murs-mc.ru/#world:${Math.round(x)}:${Math.round(y)}:${Math.round(z)}:${Math.round(distance)}:0:0.65:0:0:perspective`;
}

import type { Building3D, StreetSegment, WorldPoint } from '../types/map';

const GENERIC_STREET_PATTERNS = [
  /^$/,
  /^новая улица$/i,
  /^безымянная/i,
  /^улица$/i,
  /^дорога\s*#?\d*$/i,
  /^проезд\s*#?\d*$/i,
  /^грунтовая дорога\s*#?\d*$/i,
  /^жд путь\s*#?\d*$/i,
  /^муроморск$/i,
  /^центр$/i,
];

export function normalizeStreetKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isGenericStreetName(name?: string | null): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return true;
  return GENERIC_STREET_PATTERNS.some((rx) => rx.test(trimmed));
}

export function isAddressableStreet(street: StreetSegment): boolean {
  if (!street.points || street.points.length < 2) return false;
  if (street.roadClass === 'railway') return false;
  return true;
}

export interface StreetProjection {
  street: StreetSegment;
  /** Perpendicular distance from point to street centerline */
  centerDist: number;
  /** Distance from point to nearest road edge (centerDist - width/2, clamped >= 0) */
  edgeDist: number;
  /** Cumulative distance along this segment from points[0] */
  alongDist: number;
  /** Signed side relative to segment direction: <= 0 left (odd), > 0 right (even) */
  side: number;
  /** Foot of perpendicular on polyline */
  foot: WorldPoint;
  /** Unit tangent along the projected segment */
  tx: number;
  tz: number;
}

export function projectPointOntoStreet(
  pt: WorldPoint,
  street: StreetSegment
): StreetProjection | null {
  const pts = street.points;
  if (!pts || pts.length < 2) return null;

  let bestDistSq = Infinity;
  let bestAlong = 0;
  let bestSide = -1;
  let bestFoot: WorldPoint = pts[0];
  let bestTx = 1;
  let bestTz = 0;
  let accumLen = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const segLen = Math.sqrt(lenSq);
    if (segLen < 1e-6) continue;

    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / lenSq));
    const fx = a.x + dx * t;
    const fz = a.z + dz * t;
    const distSq = (pt.x - fx) * (pt.x - fx) + (pt.z - fz) * (pt.z - fz);

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestAlong = accumLen + segLen * t;
      // 2D cross product (seg x toPoint): > 0 right side, <= 0 left side
      const cross = dx * (pt.z - a.z) - dz * (pt.x - a.x);
      bestSide = cross > 0 ? 1 : -1;
      bestFoot = { x: fx, z: fz };
      bestTx = dx / segLen;
      bestTz = dz / segLen;
    }
    accumLen += segLen;
  }

  if (!Number.isFinite(bestDistSq)) return null;
  const centerDist = Math.sqrt(bestDistSq);
  const edgeDist = Math.max(0, centerDist - Math.max(2, street.width) * 0.5);
  return {
    street,
    centerDist,
    edgeDist,
    alongDist: bestAlong,
    side: bestSide,
    foot: bestFoot,
    tx: bestTx,
    tz: bestTz,
  };
}

/**
 * Finds the nearest addressable street to a world point within maxEdgeDist blocks.
 * Prefers named streets slightly over unnamed generic ones when distances are similar.
 */
export function findNearestAddressableStreet(
  pt: WorldPoint,
  streets: StreetSegment[],
  maxEdgeDist = 110
): StreetProjection | null {
  let best: StreetProjection | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < streets.length; i++) {
    const st = streets[i];
    if (!isAddressableStreet(st)) continue;
    const proj = projectPointOntoStreet(pt, st);
    if (!proj || proj.edgeDist > maxEdgeDist) continue;
    // Slight preference for real named streets over auto-generated generic names
    const genericPenalty = isGenericStreetName(st.name) ? 14 : 0;
    const score = proj.edgeDist + genericPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = proj;
    }
  }
  return best;
}

interface StreetGroupAxis {
  originX: number;
  originZ: number;
  dirX: number;
  dirZ: number;
  segments: StreetSegment[];
}

/**
 * Computes a consistent global ordering axis for a street that may consist of multiple
 * split StreetSegments sharing the same street name (e.g., split by auto-intersections).
 */
function buildStreetGroupAxis(segments: StreetSegment[]): StreetGroupAxis | null {
  if (segments.length === 0) return null;

  if (segments.length === 1) {
    const pts = segments[0].points;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const dx = last.x - first.x;
    const dz = last.z - first.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      return {
        originX: first.x,
        originZ: first.z,
        dirX: dx / len,
        dirZ: dz / len,
        segments,
      };
    }
  }

  // Gather all points across all segments of this street and compute dominant PCA axis
  let sumX = 0;
  let sumZ = 0;
  let count = 0;
  for (const s of segments) {
    for (const p of s.points) {
      sumX += p.x;
      sumZ += p.z;
      count++;
    }
  }
  if (count < 2) return null;
  const meanX = sumX / count;
  const meanZ = sumZ / count;

  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (const s of segments) {
    for (const p of s.points) {
      const dx = p.x - meanX;
      const dz = p.z - meanZ;
      cxx += dx * dx;
      czz += dz * dz;
      cxz += dx * dz;
    }
  }

  const angle = 0.5 * Math.atan2(2 * cxz, cxx - czz);
  let dirX = Math.cos(angle);
  let dirZ = Math.sin(angle);

  // Align direction with the first segment's natural drawing direction
  const refPts = segments[0].points;
  const refDx = refPts[refPts.length - 1].x - refPts[0].x;
  const refDz = refPts[refPts.length - 1].z - refPts[0].z;
  if (refDx * dirX + refDz * dirZ < 0) {
    dirX = -dirX;
    dirZ = -dirZ;
  }

  // Find minimum projection along axis so `along` starts near 0
  let minProj = Infinity;
  let originX = meanX;
  let originZ = meanZ;
  for (const s of segments) {
    for (const p of s.points) {
      const pr = (p.x - meanX) * dirX + (p.z - meanZ) * dirZ;
      if (pr < minProj) {
        minProj = pr;
        originX = p.x;
        originZ = p.z;
      }
    }
  }

  return { originX, originZ, dirX, dirZ, segments };
}

function measureAlongStreetGroup(
  pt: WorldPoint,
  axis: StreetGroupAxis
): { along: number; side: number; edgeDist: number } {
  // Single segment: use exact polyline arc-length and local side!
  if (axis.segments.length === 1) {
    const proj = projectPointOntoStreet(pt, axis.segments[0]);
    if (proj) {
      return { along: proj.alongDist, side: proj.side, edgeDist: proj.edgeDist };
    }
  }

  // Multi-segment street: project onto nearest segment for edge distance & local side
  // (flipped if segment runs opposite to global axis), and use global axis for monotonic ordering
  let bestProj: StreetProjection | null = null;
  for (const s of axis.segments) {
    const p = projectPointOntoStreet(pt, s);
    if (p && (!bestProj || p.edgeDist < bestProj.edgeDist)) {
      bestProj = p;
    }
  }

  const along = (pt.x - axis.originX) * axis.dirX + (pt.z - axis.originZ) * axis.dirZ;
  if (!bestProj) {
    const cross = axis.dirX * (pt.z - axis.originZ) - axis.dirZ * (pt.x - axis.originX);
    return { along, side: cross > 0 ? 1 : -1, edgeDist: Infinity };
  }

  const alignedDot = bestProj.tx * axis.dirX + bestProj.tz * axis.dirZ;
  const side = alignedDot >= 0 ? bestProj.side : -bestProj.side;
  return { along, side, edgeDist: bestProj.edgeDist };
}

/**
 * Checks whether a houseNumber looks like a custom alphanumeric override (e.g. "14А", "5к2", "10/2")
 * vs a standard auto-assignable numeric number ("1", "12", "").
 */
export function isPlainNumericHouseNumber(houseNumber?: string): boolean {
  const s = (houseNumber ?? '').trim();
  return s === '' || /^\d+$/.test(s);
}

/**
 * Renumbers buildings belonging to `streetName` in spatial order along the street:
 * - Left side (side <= 0): odd numbers 1, 3, 5, 7...
 * - Right side (side > 0): even numbers 2, 4, 6, 8...
 * Preserves custom alphanumeric suffixes (e.g., "14А", "5к2") unless `overwriteCustom` is true.
 * Returns a Map of `buildingId -> assignedHouseNumber`.
 */
export function computeStreetHouseNumbers(
  streetName: string,
  streetBuildings: Building3D[],
  allStreets: StreetSegment[],
  options?: { overwriteCustom?: boolean }
): Map<string, string> {
  const result = new Map<string, string>();
  if (streetBuildings.length === 0) return result;

  const key = normalizeStreetKey(streetName);
  const matchingSegments = allStreets.filter(
    (s) => isAddressableStreet(s) && normalizeStreetKey(s.name) === key
  );
  const axis = buildStreetGroupAxis(matchingSegments);
  const overwriteCustom = options?.overwriteCustom ?? false;

  if (!axis) {
    // Fallback when street polyline doesn't exist: sort west-to-east, north-to-south
    const sorted = [...streetBuildings].sort((a, b) => a.x - b.x || a.z - b.z);
    let nextNum = 1;
    for (const b of sorted) {
      if (!overwriteCustom && !isPlainNumericHouseNumber(b.houseNumber)) {
        result.set(b.id, b.houseNumber);
        continue;
      }
      result.set(b.id, String(nextNum));
      nextNum++;
    }
    return result;
  }

  interface RankedBuilding {
    b: Building3D;
    along: number;
    edgeDist: number;
    side: number;
  }

  const oddSide: RankedBuilding[] = [];
  const evenSide: RankedBuilding[] = [];

  for (const b of streetBuildings) {
    const m = measureAlongStreetGroup({ x: b.x, z: b.z }, axis);
    const entry: RankedBuilding = { b, along: m.along, edgeDist: m.edgeDist, side: m.side };
    if (m.side <= 0) oddSide.push(entry);
    else evenSide.push(entry);
  }

  const sortAlong = (a: RankedBuilding, b: RankedBuilding) =>
    Math.abs(a.along - b.along) > 1.5
      ? a.along - b.along
      : a.edgeDist - b.edgeDist || a.b.id.localeCompare(b.b.id);

  oddSide.sort(sortAlong);
  evenSide.sort(sortAlong);

  const assignSide = (list: RankedBuilding[], startNum: number) => {
    const usedNumbers = new Set<number>();
    if (!overwriteCustom) {
      for (const item of list) {
        if (!isPlainNumericHouseNumber(item.b.houseNumber)) {
          result.set(item.b.id, item.b.houseNumber);
          const leading = parseInt(item.b.houseNumber, 10);
          if (Number.isFinite(leading) && leading > 0) usedNumbers.add(leading);
        }
      }
    }
    let num = startNum;
    for (const item of list) {
      if (!overwriteCustom && !isPlainNumericHouseNumber(item.b.houseNumber)) {
        continue;
      }
      while (usedNumbers.has(num)) num += 2;
      result.set(item.b.id, String(num));
      usedNumbers.add(num);
      num += 2;
    }
  };

  assignSide(oddSide, 1);
  assignSide(evenSide, 2);
  return result;
}

/**
 * Automatically assigns street (if generic/unset) and updates sequential odd/even house
 * numbering along that street whenever a new building is created.
 */
export function autoAddressNewBuilding(
  created: Building3D,
  existingBuildings: Building3D[],
  streets: StreetSegment[],
  maxStreetDist = 110
): {
  created: Building3D;
  updatedExisting: Building3D[];
  streetName: string;
} {
  let targetStreetName = created.street.trim();
  let targetDistrict = created.district;

  // Check if created.street matches an actual street segment
  const hasMatchingStreet =
    !isGenericStreetName(targetStreetName) &&
    streets.some(
      (s) =>
        isAddressableStreet(s) &&
        normalizeStreetKey(s.name) === normalizeStreetKey(targetStreetName)
    );

  if (!hasMatchingStreet) {
    const nearest = findNearestAddressableStreet({ x: created.x, z: created.z }, streets, maxStreetDist);
    if (nearest) {
      targetStreetName = nearest.street.name;
      if (nearest.street.district && nearest.street.district.trim()) {
        targetDistrict = nearest.street.district;
      }
    }
  }

  const streetKey = normalizeStreetKey(targetStreetName);
  const resolvedCreated: Building3D = {
    ...created,
    street: targetStreetName || created.street,
    district: targetDistrict || created.district,
  };

  const hasAddressablePolyline =
    streetKey.length > 0 &&
    streets.some((s) => isAddressableStreet(s) && normalizeStreetKey(s.name) === streetKey);

  if (!hasAddressablePolyline) {
    // No nearby road: assign next unused sequential integer in the same street/district
    const sameGroup = existingBuildings.filter(
      (b) => b.id !== created.id && normalizeStreetKey(b.street) === streetKey
    );
    let maxNum = 0;
    for (const b of sameGroup) {
      const parsed = parseInt(b.houseNumber, 10);
      if (Number.isFinite(parsed) && parsed > maxNum) maxNum = parsed;
    }
    return {
      created: { ...resolvedCreated, houseNumber: String(maxNum + 1) },
      updatedExisting: [],
      streetName: resolvedCreated.street,
    };
  }

  // Gather all buildings on this street + the new building and compute clean odd/even numbering
  const sameStreetExisting = existingBuildings.filter(
    (b) => b.id !== created.id && normalizeStreetKey(b.street) === streetKey
  );
  const allOnStreet = [...sameStreetExisting, resolvedCreated];
  const numberMap = computeStreetHouseNumbers(targetStreetName, allOnStreet, streets);

  const finalCreated: Building3D = {
    ...resolvedCreated,
    houseNumber: numberMap.get(resolvedCreated.id) ?? '1',
  };

  const updatedExisting: Building3D[] = [];
  for (const b of sameStreetExisting) {
    const nextNum = numberMap.get(b.id);
    if (nextNum && nextNum !== b.houseNumber) {
      updatedExisting.push({ ...b, houseNumber: nextNum, isUserEdited: true });
    }
  }

  return {
    created: finalCreated,
    updatedExisting,
    streetName: targetStreetName,
  };
}

/**
 * Automatically attaches nearby buildings to a newly created or renamed street and updates
 * their sequential odd/even house numbers along the street corridor.
 */
export function autoAddressBuildingsForStreet(
  savedStreet: StreetSegment,
  allBuildings: Building3D[],
  allStreets: StreetSegment[],
  options?: {
    previousStreetName?: string;
    corridorRadius?: number;
    overwriteCustom?: boolean;
  }
): {
  updatedBuildings: Building3D[];
  affectedCount: number;
} {
  if (!isAddressableStreet(savedStreet)) {
    return { updatedBuildings: [], affectedCount: 0 };
  }

  const newStreetName = savedStreet.name.trim();
  const newKey = normalizeStreetKey(newStreetName);
  const prevKey = options?.previousStreetName
    ? normalizeStreetKey(options.previousStreetName)
    : '';
  const corridorRadius = options?.corridorRadius ?? 72;

  // Ensure savedStreet is present in street list for unified multi-segment ordering
  const streetsWithSaved = [
    ...allStreets.filter((s) => s.id !== savedStreet.id),
    savedStreet,
  ];
  const otherStreets = streetsWithSaved.filter(
    (s) => isAddressableStreet(s) && normalizeStreetKey(s.name) !== newKey
  );

  // Collect all buildings that should belong to this street:
  // 1. Already assigned to `newStreetName`
  // 2. Were assigned to `previousStreetName` (when user renamed this street!)
  // 3. Located inside this street's corridor AND either:
  //    - currently have a generic/empty street name (or district fallback), OR
  //    - this new street is strictly closer than any other named street they currently reference
  const attached: Building3D[] = [];
  const attachedIds = new Set<string>();

  for (const b of allBuildings) {
    const bKey = normalizeStreetKey(b.street);
    const alreadySame = bKey === newKey;
    const renamedFromPrev = prevKey.length > 0 && prevKey !== newKey && bKey === prevKey;

    if (alreadySame || renamedFromPrev) {
      attached.push({
        ...b,
        street: newStreetName,
        district: savedStreet.district?.trim() ? savedStreet.district : b.district,
      });
      attachedIds.add(b.id);
      continue;
    }

    const projNew = projectPointOntoStreet({ x: b.x, z: b.z }, savedStreet);
    if (!projNew || projNew.edgeDist > corridorRadius) continue;

    // Check if building's current street is generic/unset or doesn't correspond to a closer real street
    const bHasRealNamedStreet =
      !isGenericStreetName(b.street) &&
      otherStreets.some((s) => normalizeStreetKey(s.name) === bKey);

    if (!bHasRealNamedStreet) {
      attached.push({
        ...b,
        street: newStreetName,
        district: savedStreet.district?.trim() ? savedStreet.district : b.district,
      });
      attachedIds.add(b.id);
      continue;
    }

    // Even if building had another street, only reassign if this new street is MUCH closer
    // (e.g. building sits right alongside the newly drawn street while old street is far away)
    let curStreetDist = Infinity;
    for (const s of otherStreets) {
      if (normalizeStreetKey(s.name) !== bKey) continue;
      const p = projectPointOntoStreet({ x: b.x, z: b.z }, s);
      if (p && p.edgeDist < curStreetDist) curStreetDist = p.edgeDist;
    }
    if (projNew.edgeDist + 14 < curStreetDist) {
      attached.push({
        ...b,
        street: newStreetName,
        district: savedStreet.district?.trim() ? savedStreet.district : b.district,
      });
      attachedIds.add(b.id);
    }
  }

  if (attached.length === 0) {
    return { updatedBuildings: [], affectedCount: 0 };
  }

  const numberMap = computeStreetHouseNumbers(newStreetName, attached, streetsWithSaved, {
    overwriteCustom: options?.overwriteCustom,
  });

  const origById = new Map(allBuildings.map((b) => [b.id, b]));
  const updatedBuildings: Building3D[] = [];

  for (const b of attached) {
    const orig = origById.get(b.id);
    const nextNum = numberMap.get(b.id) ?? b.houseNumber;
    const changed =
      !orig ||
      orig.street !== b.street ||
      orig.houseNumber !== nextNum ||
      orig.district !== b.district;
    if (changed) {
      updatedBuildings.push({
        ...b,
        houseNumber: nextNum,
        isUserEdited: true,
      });
    }
  }

  return {
    updatedBuildings,
    affectedCount: updatedBuildings.length,
  };
}

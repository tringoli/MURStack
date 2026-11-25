import type { WorldPoint, WorldPoint3D } from '../types/map';

/**
 * Astronomical Solar Insolation Engine calibrated for Kaliningrad (KALT, UTC+2).
 *
 * Uses NOAA / Meeus solar ephemeris equations to compute real-time Earth-Sun geometry:
 * - Julian Day & Julian Century
 * - Mean solar longitude, mean anomaly, equation of center & ecliptic obliquity
 * - Solar declination & Equation of Time
 * - True solar altitude (with atmospheric refraction) & clockwise azimuth from True North
 * - Exact Minecraft world-space shadow projection (+X East, -Z North, +Y Up)
 */

export const KALININGRAD_GEO = {
  name: 'Калининград',
  latDeg: 54.7104,
  lonDeg: 20.4522,
  /** Kaliningrad Time (KALT) = UTC+2 year-round (no DST since 2014) */
  utcOffsetHours: 2,
} as const;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type SolarPhase =
  | 'day'
  | 'golden-hour'
  | 'civil-twilight'
  | 'nautical-twilight'
  | 'night';

export interface SolarPosition {
  /** Solar elevation angle above horizon in degrees (-90..+90), refraction-corrected near horizon */
  altitudeDeg: number;
  /** True geometric altitude before atmospheric refraction */
  rawAltitudeDeg: number;
  /** Solar azimuth in degrees clockwise from True North (0=N, 90=E, 180=S, 270=W) */
  azimuthDeg: number;
  /** Solar declination in degrees (-23.44..+23.44) */
  declinationDeg: number;
  /** Unit vector pointing TOWARD the Sun in Minecraft world space (+X East, +Y Up, -Z North) */
  sunDir: { x: number; y: number; z: number };
  /** Horizontal unit vector pointing in the direction shadows are cast (+X East, +Z South) */
  shadowDir: { x: number; z: number };
  /** Horizontal shadow length per 1 block of vertical height (clamped for grazing angles, 0 at night) */
  shadowLengthPerBlock: number;
  /** Recommended unified cast-shadow opacity (0..1) factoring solar elevation & twilight */
  shadowOpacity: number;
  /** Ambient daylight brightness factor (0 = deep night, 1 = high noon) */
  daylightFactor: number;
  /** Warm golden-hour factor (0..1) peaking near sunrise/sunset */
  goldenHourFactor: number;
  /** Qualitative lighting phase */
  phase: SolarPhase;
  /** Russian human-readable lighting phase label */
  phaseLabel: string;
  /** Local sunrise time in minutes from midnight (null only in polar day/night) */
  sunriseMinutes: number | null;
  /** Local solar noon time in minutes from midnight */
  solarNoonMinutes: number;
  /** Local sunset time in minutes from midnight (null only in polar day/night) */
  sunsetMinutes: number | null;
  /** Total daylight duration in minutes */
  dayLengthMinutes: number;
}

/**
 * Returns current real date (YYYY-MM-DD) and local minutes from midnight in Kaliningrad (UTC+2).
 */
export function getCurrentKaliningradDateTime(now: Date = new Date()): {
  dateIso: string;
  minutesOfDay: number;
} {
  const kaltMs = now.getTime() + KALININGRAD_GEO.utcOffsetHours * 3600 * 1000;
  const kalt = new Date(kaltMs);
  const y = kalt.getUTCFullYear();
  const m = String(kalt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kalt.getUTCDate()).padStart(2, '0');
  const mins = kalt.getUTCHours() * 60 + kalt.getUTCMinutes();
  return {
    dateIso: `${y}-${m}-${d}`,
    minutesOfDay: mins,
  };
}

/**
 * Formats minutes from midnight (0..1439) as HH:MM.
 */
export function formatMinutesHHMM(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—:—';
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Parses a YYYY-MM-DD string and local minutesOfDay (in utcOffsetHours) into a UTC timestamp in ms.
 */
export function buildUtcMsFromLocalDateAndMinutes(
  dateIso: string,
  minutesOfDay: number,
  utcOffsetHours: number = KALININGRAD_GEO.utcOffsetHours
): number {
  const parts = dateIso.split('-').map((s) => Number(s));
  const year = Number.isFinite(parts[0]) && parts[0] >= 1900 ? parts[0] : 2026;
  const month = Number.isFinite(parts[1]) && parts[1] >= 1 && parts[1] <= 12 ? parts[1] : 6;
  const day = Number.isFinite(parts[2]) && parts[2] >= 1 && parts[2] <= 31 ? parts[2] : 21;
  const clampedMins = Math.max(0, Math.min(1439.99, minutesOfDay));
  const utcMidnightMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return utcMidnightMs + (clampedMins - utcOffsetHours * 60) * 60 * 1000;
}

/**
 * Converts UTC timestamp in milliseconds to Julian Day.
 */
function utcMsToJulianDay(utcMs: number): number {
  return utcMs / 86400000 + 2440587.5;
}

/**
 * Core NOAA solar ephemeris evaluation at an exact UTC millisecond timestamp.
 */
export function computeSolarPosition(
  dateIso: string,
  minutesOfDay: number,
  latDeg: number = KALININGRAD_GEO.latDeg,
  lonDeg: number = KALININGRAD_GEO.lonDeg,
  utcOffsetHours: number = KALININGRAD_GEO.utcOffsetHours
): SolarPosition {
  const utcMs = buildUtcMsFromLocalDateAndMinutes(dateIso, minutesOfDay, utcOffsetHours);
  const jd = utcMsToJulianDay(utcMs);
  const T = (jd - 2451545.0) / 36525.0;

  // Geometric mean longitude & anomaly of the Sun (degrees)
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
  const L0Norm = L0 < 0 ? L0 + 360 : L0;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const MRad = M * DEG_TO_RAD;

  // Eccentricity of Earth's orbit
  const ecc = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  // Sun's Equation of Center (degrees)
  const eqCenter =
    Math.sin(MRad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * MRad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * MRad) * 0.000289;

  // Sun's true longitude & apparent longitude
  const trueLong = L0Norm + eqCenter;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG_TO_RAD);

  // Mean & corrected obliquity of the ecliptic (degrees)
  const meanObliq =
    23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const corrObliq = meanObliq + 0.00256 * Math.cos(omega * DEG_TO_RAD);
  const obliqRad = corrObliq * DEG_TO_RAD;

  // Solar declination (radians & degrees)
  const sinDecl = Math.sin(obliqRad) * Math.sin(appLong * DEG_TO_RAD);
  const declRad = Math.asin(Math.max(-1, Math.min(1, sinDecl)));
  const declinationDeg = declRad * RAD_TO_DEG;

  // Equation of Time (minutes)
  const yTan = Math.tan(obliqRad * 0.5);
  const varY = yTan * yTan;
  const L0Rad = L0Norm * DEG_TO_RAD;
  const eqOfTimeMin =
    4 *
    RAD_TO_DEG *
    (varY * Math.sin(2 * L0Rad) -
      2 * ecc * Math.sin(MRad) +
      4 * ecc * varY * Math.sin(MRad) * Math.cos(2 * L0Rad) -
      0.5 * varY * varY * Math.sin(4 * L0Rad) -
      1.25 * ecc * ecc * Math.sin(2 * MRad));

  // True Solar Time (minutes) & Hour Angle (degrees)
  const trueSolarTime =
    (((minutesOfDay + eqOfTimeMin + 4 * lonDeg - 60 * utcOffsetHours) % 1440) + 1440) % 1440;
  const hourAngleDeg = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;
  const haRad = hourAngleDeg * DEG_TO_RAD;
  const latRad = latDeg * DEG_TO_RAD;

  // Solar zenith & raw elevation
  const cosZenith = Math.max(
    -1,
    Math.min(1, Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad))
  );
  const zenithRad = Math.acos(cosZenith);
  const rawAltitudeDeg = 90 - zenithRad * RAD_TO_DEG;

  // Approximate atmospheric refraction correction (NOAA formula)
  let refractionDeg = 0;
  if (rawAltitudeDeg > 85) {
    refractionDeg = 0;
  } else if (rawAltitudeDeg > 5) {
    const te = Math.tan(rawAltitudeDeg * DEG_TO_RAD);
    refractionDeg = (58.1 / te - 0.07 / (te * te * te) + 0.000086 / Math.pow(te, 5)) / 3600;
  } else if (rawAltitudeDeg > -0.575) {
    const h = rawAltitudeDeg;
    refractionDeg =
      (1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)))) / 3600;
  } else {
    refractionDeg = -20.774 / Math.tan(rawAltitudeDeg * DEG_TO_RAD) / 3600;
  }
  const altitudeDeg = rawAltitudeDeg + refractionDeg;

  // Solar azimuth clockwise from True North (0=N, 90=E, 180=S, 270=W)
  const sinZenith = Math.sin(zenithRad);
  let azimuthDeg = 180;
  if (sinZenith > 1e-6) {
    const cosAzRaw =
      (Math.sin(latRad) * cosZenith - Math.sin(declRad)) / (Math.cos(latRad) * sinZenith);
    const acosAz = Math.acos(Math.max(-1, Math.min(1, cosAzRaw))) * RAD_TO_DEG;
    if (hourAngleDeg > 0) {
      azimuthDeg = (acosAz + 180) % 360;
    } else {
      azimuthDeg = (540 - acosAz) % 360;
    }
  }

  // Sunrise, solar noon, sunset (in local minutes from midnight)
  const solarNoonMinutes = 720 - 4 * lonDeg - eqOfTimeMin + utcOffsetHours * 60;
  const cosHaSunrise =
    Math.cos(90.833 * DEG_TO_RAD) / (Math.cos(latRad) * Math.cos(declRad)) -
    Math.tan(latRad) * Math.tan(declRad);

  let sunriseMinutes: number | null = null;
  let sunsetMinutes: number | null = null;
  let dayLengthMinutes = 0;
  if (cosHaSunrise >= -1 && cosHaSunrise <= 1) {
    const haSunriseDeg = Math.acos(cosHaSunrise) * RAD_TO_DEG;
    sunriseMinutes = solarNoonMinutes - haSunriseDeg * 4;
    sunsetMinutes = solarNoonMinutes + haSunriseDeg * 4;
    dayLengthMinutes = haSunriseDeg * 8;
  } else if (cosHaSunrise < -1) {
    dayLengthMinutes = 1440; // Midnight sun
  } else {
    dayLengthMinutes = 0; // Polar night
  }

  // World-space vectors in Minecraft coordinates (+X East, +Y Up, -Z North, +Z South)
  const altRad = altitudeDeg * DEG_TO_RAD;
  const azRad = azimuthDeg * DEG_TO_RAD;
  const cosAlt = Math.cos(altRad);
  const sinAlt = Math.sin(altRad);
  const sinAz = Math.sin(azRad);
  const cosAz = Math.cos(azRad);

  const sunDir = {
    x: cosAlt * sinAz,
    y: sinAlt,
    z: -cosAlt * cosAz,
  };

  // Horizontal shadow direction is opposite to the Sun's horizontal bearing
  const shadowDir = {
    x: -sinAz,
    z: cosAz,
  };

  // Shadow length per 1 block of vertical height (cot(alt)), gracefully clamped at grazing angles
  const MAX_SHADOW_RATIO = 5.4;
  let shadowLengthPerBlock = 0;
  if (altitudeDeg > -1.0) {
    const effAltDeg = Math.max(0.5, altitudeDeg);
    const rawCot = 1 / Math.tan(effAltDeg * DEG_TO_RAD);
    // Soft knee approaching MAX_SHADOW_RATIO so low-sun shadows never shoot infinitely across the map
    shadowLengthPerBlock =
      (rawCot * MAX_SHADOW_RATIO) / Math.hypot(rawCot, MAX_SHADOW_RATIO);
  }

  // Smooth lighting & shadow opacity envelopes
  const smooth = (a: number, b: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // Shadows appear gently from -0.5° to +6° and stay crisp throughout daylight
  const shadowOpacity = smooth(-0.5, 6.5, altitudeDeg);
  const daylightFactor = smooth(-6.0, 14.0, altitudeDeg);
  const goldenHourFactor =
    smooth(-3.5, 4.0, altitudeDeg) * (1 - smooth(9.0, 21.0, altitudeDeg));

  let phase: SolarPhase;
  let phaseLabel: string;
  if (altitudeDeg >= 12) {
    phase = 'day';
    phaseLabel = 'День';
  } else if (altitudeDeg >= 0) {
    phase = 'golden-hour';
    phaseLabel = minutesOfDay < solarNoonMinutes ? 'Рассвет' : 'Закат';
  } else if (altitudeDeg >= -6) {
    phase = 'civil-twilight';
    phaseLabel = 'Гражданские сумерки';
  } else if (altitudeDeg >= -12) {
    phase = 'nautical-twilight';
    phaseLabel = 'Сумерки';
  } else {
    phase = 'night';
    phaseLabel = 'Ночь';
  }

  return {
    altitudeDeg,
    rawAltitudeDeg,
    azimuthDeg,
    declinationDeg,
    sunDir,
    shadowDir,
    shadowLengthPerBlock,
    shadowOpacity,
    daylightFactor,
    goldenHourFactor,
    phase,
    phaseLabel,
    sunriseMinutes,
    solarNoonMinutes,
    sunsetMinutes,
    dayLengthMinutes,
  };
}

/**
 * Computes the horizontal world-space shadow displacement `(dx, dz)` for an object of vertical height `heightBlocks`.
 */
export function computeShadowOffset(
  heightBlocks: number,
  solar: SolarPosition
): { dx: number; dz: number } {
  if (heightBlocks <= 0 || solar.shadowLengthPerBlock <= 0) {
    return { dx: 0, dz: 0 };
  }
  const len = heightBlocks * solar.shadowLengthPerBlock;
  return {
    dx: solar.shadowDir.x * len,
    dz: solar.shadowDir.z * len,
  };
}

/**
 * Computes the exact ground shadow footprint components for an arbitrary polygon wing of height `heightBlocks`:
 * - `shiftedRoof`: the roof polygon translated along the solar ray to the ground plane
 * - `sideQuads`: swept parallelogram quads connecting each edge `(P[i], P[i+1])` to `(S[i+1], S[i])`
 *
 * Rendering `shiftedRoof` + all `sideQuads` into a solid-fill offscreen mask guarantees exact shadow coverage
 * for rectangles, parallelograms, triangles, circles, AND concave freeform polygons with zero self-overlap artifacts
 * when composited in one pass.
 */
export function computeWingShadowGeometry(
  footprint: WorldPoint[],
  heightBlocks: number,
  solar: SolarPosition
): {
  shiftedRoof: WorldPoint[];
  dx: number;
  dz: number;
} | null {
  if (footprint.length < 3 || heightBlocks <= 0.2 || solar.shadowOpacity <= 0.01) {
    return null;
  }
  const { dx, dz } = computeShadowOffset(heightBlocks, solar);
  if (Math.hypot(dx, dz) < 0.2) return null;

  const shiftedRoof = new Array<WorldPoint>(footprint.length);
  for (let i = 0; i < footprint.length; i++) {
    shiftedRoof[i] = {
      x: footprint[i].x + dx,
      z: footprint[i].z + dz,
    };
  }
  return { shiftedRoof, dx, dz };
}

/**
 * Normalizes a 2D screen-space polygon to clockwise winding (signed area >= 0
 * in standard canvas coordinates where +X is right and +Y is down).
 * Ensuring consistent winding for all subpaths in a single `ctx.beginPath()`
 * prevents Canvas `nonzero` fill-rule cancellation holes when shadows overlap.
 */
export function ensureScreenPolygonCW<T extends { sx: number; sy: number }>(pts: T[]): T[] {
  const n = pts.length;
  if (n < 3) return pts;
  let signedArea2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea2 += pts[i].sx * pts[j].sy - pts[j].sx * pts[i].sy;
  }
  if (signedArea2 < 0) {
    return [...pts].reverse();
  }
  return pts;
}

/**
 * Clips a 2D world polygon against the half-plane `(x - px)*nx + (z - pz)*nz >= 0`
 * using Sutherland-Hodgman clipping.
 */
export function clipPolygonToHalfPlane(
  poly: WorldPoint[],
  px: number,
  pz: number,
  nx: number,
  nz: number
): WorldPoint[] {
  if (poly.length < 3) return [];
  const out: WorldPoint[] = [];
  const dist = (pt: WorldPoint) => (pt.x - px) * nx + (pt.z - pz) * nz;

  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const dc = dist(curr);
    const dp = dist(prev);
    const currIn = dc >= -1e-5;
    const prevIn = dp >= -1e-5;

    if (currIn) {
      if (!prevIn) {
        const t = dp / (dp - dc);
        out.push({
          x: prev.x + (curr.x - prev.x) * t,
          z: prev.z + (curr.z - prev.z) * t,
        });
      }
      out.push(curr);
    } else if (prevIn) {
      const t = dp / (dp - dc);
      out.push({
        x: prev.x + (curr.x - prev.x) * t,
        z: prev.z + (curr.z - prev.z) * t,
      });
    }
  }
  return out;
}

/**
 * Computes exact 3D shadow polygons cast by a nearby upwind building wing onto
 * a sun-facing vertical wall `(wallA -> wallB)` with outward normal `(wallOutNx, wallOutNz)`.
 * Returned polygons are in world 3D coordinates ready for `proj(x, z, elev)` + wall `ctx.clip()`.
 */
export function computeWallShadowPolygons(
  wallA: WorldPoint,
  wallB: WorldPoint,
  wallOutNx: number,
  wallOutNz: number,
  wallBaseY: number,
  wallTopY: number,
  casterFootprint: WorldPoint[],
  casterBaseY: number,
  casterTopY: number,
  solar: SolarPosition
): WorldPoint3D[][] {
  if (
    casterFootprint.length < 3 ||
    solar.shadowOpacity <= 0.01 ||
    solar.shadowLengthPerBlock <= 0.01 ||
    casterTopY <= wallBaseY + 0.2 ||
    wallTopY <= wallBaseY + 0.1
  ) {
    return [];
  }

  const horizLen = Math.hypot(solar.sunDir.x, solar.sunDir.z);
  if (horizLen < 1e-4) return [];
  const sx = solar.sunDir.x / horizLen;
  const sz = solar.sunDir.z / horizLen;

  // Wall must face toward the sun
  const denom = wallOutNx * sx + wallOutNz * sz;
  if (denom <= 0.04) return [];

  const clipped = clipPolygonToHalfPlane(casterFootprint, wallA.x, wallA.z, wallOutNx, wallOutNz);
  if (clipped.length < 3) return [];

  const wallDx = wallB.x - wallA.x;
  const wallDz = wallB.z - wallA.z;
  const wallLen = Math.hypot(wallDx, wallDz);
  if (wallLen < 0.05) return [];
  const tx = wallDx / wallLen;
  const tz = wallDz / wallLen;

  const dropPerBlock = 1 / solar.shadowLengthPerBlock;

  const topPts: WorldPoint3D[] = new Array(clipped.length);
  const basePts: WorldPoint3D[] = new Array(clipped.length);
  let maxTopY = -Infinity;
  let minBaseY = Infinity;
  let minU = Infinity;
  let maxU = -Infinity;

  for (let i = 0; i < clipped.length; i++) {
    const q = clipped[i];
    const signedDist = Math.max(0, (q.x - wallA.x) * wallOutNx + (q.z - wallA.z) * wallOutNz);
    const tRay = signedDist / denom;
    const hitX = q.x - tRay * sx;
    const hitZ = q.z - tRay * sz;
    const hitTopY = casterTopY - tRay * dropPerBlock;
    const hitBaseY = casterBaseY - tRay * dropPerBlock;

    topPts[i] = { x: hitX, y: hitTopY, z: hitZ };
    basePts[i] = { x: hitX, y: hitBaseY, z: hitZ };

    if (hitTopY > maxTopY) maxTopY = hitTopY;
    if (hitBaseY < minBaseY) minBaseY = hitBaseY;

    const u = (hitX - wallA.x) * tx + (hitZ - wallA.z) * tz;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
  }

  if (maxTopY <= wallBaseY + 0.05 || minBaseY >= wallTopY - 0.05) return [];
  if (maxU <= 0.05 || minU >= wallLen - 0.05) return [];

  const polys: WorldPoint3D[][] = [topPts];
  for (let i = 0; i < clipped.length; i++) {
    const nxt = (i + 1) % clipped.length;
    polys.push([basePts[i], basePts[nxt], topPts[nxt], topPts[i]]);
  }
  return polys;
}

/**
 * Computes normalized solar illumination (0 = deep shade, 1 = direct sunlight) on a vertical building facade
 * with outward world unit normal `(outNx, outNz)` given the active solar position.
 */
export function computeFacadeSolarIntensity(
  outNx: number,
  outNz: number,
  solar: SolarPosition
): number {
  if (solar.altitudeDeg <= -2) return 0.18;
  const horizLen = Math.hypot(solar.sunDir.x, solar.sunDir.z);
  if (horizLen < 1e-4) return 0.6;
  const sx = solar.sunDir.x / horizLen;
  const sz = solar.sunDir.z / horizLen;
  const ndotl = outNx * sx + outNz * sz; // -1..+1
  const direct = Math.max(0, ndotl) * Math.cos(Math.max(0, solar.altitudeDeg) * DEG_TO_RAD * 0.45);
  return Math.max(0.15, Math.min(1, 0.34 + direct * 0.66 * solar.shadowOpacity));
}

/**
 * Returns compass cardinal label (С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ) for an azimuth in degrees.
 */
export function formatAzimuthCompassRu(azimuthDeg: number): string {
  const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const idx = Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

/**
 * Astronomical seasonal presets for quick insolation inspection (SNiP / urban planning standards).
 */
export const INSOLATION_DATE_PRESETS: Array<{ label: string; shortLabel: string; dateIso: string }> = [
  { label: 'Весеннее равноденствие', shortLabel: '21 мар', dateIso: '2026-03-21' },
  { label: 'Летнее солнцестояние', shortLabel: '21 июн', dateIso: '2026-06-21' },
  { label: 'Осеннее равноденствие', shortLabel: '23 сен', dateIso: '2026-09-23' },
  { label: 'Зимнее солнцестояние', shortLabel: '21 дек', dateIso: '2026-12-21' },
];

/**
 * Physically consistent default daylight directional light used for ambient 3D shadows
 * when interactive Solar Insolation mode is off.
 * Casts soft world-space shadows toward ESE (azimuth 305° WNW, altitude 56°) so neighboring
 * buildings share unified offscreen ground shadows, water attenuation, and roof/wall occlusion
 * without ever stacking or floating detached from walls.
 */
export const AMBIENT_SOLAR_POSITION: SolarPosition = (() => {
  const altitudeDeg = 56;
  const azimuthDeg = 305;
  const altRad = altitudeDeg * DEG_TO_RAD;
  const azRad = azimuthDeg * DEG_TO_RAD;
  const cosAlt = Math.cos(altRad);
  const sinAlt = Math.sin(altRad);
  const sinAz = Math.sin(azRad);
  const cosAz = Math.cos(azRad);
  return {
    altitudeDeg,
    rawAltitudeDeg: altitudeDeg,
    azimuthDeg,
    declinationDeg: 18,
    sunDir: {
      x: cosAlt * sinAz,
      y: sinAlt,
      z: -cosAlt * cosAz,
    },
    shadowDir: {
      x: -sinAz,
      z: cosAz,
    },
    shadowLengthPerBlock: 1 / Math.tan(altRad), // ~0.674 blocks per block of height
    shadowOpacity: 1,
    daylightFactor: 1,
    goldenHourFactor: 0,
    phase: 'day',
    phaseLabel: 'День',
    sunriseMinutes: 300,
    solarNoonMinutes: 760,
    sunsetMinutes: 1220,
    dayLengthMinutes: 920,
  };
})();


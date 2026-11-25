import type { DepartureInfo, MtrRoute } from '../types/map';

export const DAY_MS = 86_400_000;

export interface RouteTimingProfile {
  /** Cumulative ms from origin stop departure (0) to ARRIVING at stop i */
  stopArrivalOffsetsMs: number[];
  /** Cumulative ms from origin stop departure (0) to DEPARTING from stop i */
  stopDepartureOffsetsMs: number[];
  /** Total trip duration in ms from origin departure to final stop arrival */
  totalDurationMs: number;
}

export interface ScheduledVehiclePosition {
  /** Normalized distance along route polyline (0..1) */
  progress01: number;
  /** Current or last passed stop index */
  stopIndex: number;
  /** Whether the vehicle is currently dwelling at a stop */
  atStop: boolean;
  /** Origin departure ms-of-day (UTC) that spawned this vehicle */
  originDepartureMs: number;
}

export interface NextDepartureResult {
  /** Wait time in seconds until the vehicle departs this stop */
  waitSec: number;
  /** Exact epoch timestamp (ms) when the vehicle departs this stop */
  departureEpochMs: number;
  /** True when backed by live MTR departures table, false when estimated from route headway */
  isScheduled: boolean;
}

const timingCache = new WeakMap<MtrRoute, RouteTimingProfile>();

/**
 * Precomputes exact cumulative arrival & departure offsets (in ms from stop 0 departure)
 * for every stop along an MTR route, including per-stop dwell times.
 */
export function getRouteTimingProfile(route: MtrRoute): RouteTimingProfile {
  const cached = timingCache.get(route);
  if (cached) return cached;

  const n = route.stops.length;
  const stopArrivalOffsetsMs: number[] = new Array(n).fill(0);
  const stopDepartureOffsetsMs: number[] = new Array(n).fill(0);

  let accMs = 0;
  for (let i = 0; i < n; i++) {
    stopArrivalOffsetsMs[i] = accMs;
    const dwell = i === 0 ? 0 : Math.max(4_000, Math.min(90_000, route.stops[i]?.dwellMs ?? 12_000));
    if (i < n - 1) {
      accMs += dwell;
      stopDepartureOffsetsMs[i] = accMs;
      const segMs = Math.max(6_000, route.segmentDurationsMs[i] ?? 25_000);
      accMs += segMs;
    } else {
      stopDepartureOffsetsMs[i] = accMs;
    }
  }

  const profile: RouteTimingProfile = {
    stopArrivalOffsetsMs,
    stopDepartureOffsetsMs,
    totalDurationMs: Math.max(10_000, accMs),
  };
  timingCache.set(route, profile);
  return profile;
}

function hashRoutePhaseMs(routeId: string, headwayMs: number): number {
  let h = 2166136261;
  for (let i = 0; i < routeId.length; i++) {
    h ^= routeId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % Math.max(1, Math.floor(headwayMs)));
}

/**
 * Computes the exact wait time and boarding departure timestamp at `stopIdx` on `route`
 * for a passenger arriving at `atEpochMs` (real UTC epoch ms, synced with user's local clock).
 */
export function getNextDepartureWaitSec(
  route: MtrRoute,
  stopIdx: number,
  atEpochMs: number,
  departureInfo?: DepartureInfo
): NextDepartureResult {
  const profile = getRouteTimingProfile(route);
  const clampedIdx = Math.max(0, Math.min(route.stops.length - 1, stopIdx));
  const stopOffsetMs = profile.stopDepartureOffsetsMs[clampedIdx] ?? 0;

  if (departureInfo && departureInfo.departuresMs.length > 0) {
    const deps = departureInfo.departuresMs;
    // A train departing origin at `originDepMs` departs `stopIdx` at `originDepMs + stopOffsetMs`.
    // We need the smallest `originDepMs` (wrapping UTC midnight) such that:
    //   ((originDepMs + stopOffsetMs) - atUtcTod + DAY_MS) % DAY_MS is minimized and >= 0
    // Equivalently, we need the first `originDepMs >= neededOriginTod` (mod DAY_MS).
    const neededOriginTod = (((atEpochMs - stopOffsetMs) % DAY_MS) + DAY_MS) % DAY_MS;

    // Binary search for first dep >= neededOriginTod
    let lo = 0;
    let hi = deps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (deps[mid] < neededOriginTod) lo = mid + 1;
      else hi = mid;
    }

    let waitMs: number;
    if (lo < deps.length) {
      waitMs = deps[lo] - neededOriginTod;
    } else {
      waitMs = DAY_MS - neededOriginTod + deps[0];
    }
    // Guard against stale/sparse schedule returning absurd multi-hour waits if another departure is right around
    const waitSec = Math.max(0, Math.round(waitMs / 1000));
    return {
      waitSec,
      departureEpochMs: atEpochMs + waitSec * 1000,
      isScheduled: true,
    };
  }

  // Deterministic schedule-aligned fallback anchored to UTC midnight using route headway
  const headwayMs = Math.max(30_000, (route.headwaySec || 180) * 1000);
  const phaseMs = hashRoutePhaseMs(route.id, headwayMs);
  const neededOriginTod = (((atEpochMs - stopOffsetMs) % DAY_MS) + DAY_MS) % DAY_MS;
  const rem = (((neededOriginTod - phaseMs) % headwayMs) + headwayMs) % headwayMs;
  const waitMs = rem === 0 ? 0 : headwayMs - rem;
  const waitSec = Math.max(0, Math.round(waitMs / 1000));

  return {
    waitSec,
    departureEpochMs: atEpochMs + waitSec * 1000,
    isScheduled: false,
  };
}

/**
 * Computes exact live positions of ALL active vehicles currently operating on `route`
 * at `nowEpochMs` directly from the real MTR departures schedule (including dwell at stations).
 */
export function computeActiveVehiclesOnRoute(
  route: MtrRoute,
  nowEpochMs: number,
  departureInfo?: DepartureInfo,
  maxVehicles = 8
): ScheduledVehiclePosition[] {
  const n = route.stops.length;
  if (n < 2) return [];

  const profile = getRouteTimingProfile(route);
  const totalMs = profile.totalDurationMs;
  const nowTod = ((nowEpochMs % DAY_MS) + DAY_MS) % DAY_MS;

  // Compute cumulative geometric stop fractions (0..1) so vehicles pause cleanly at exact station positions
  const cumStopDist: number[] = new Array(n).fill(0);
  let totalGeomDist = 0;
  for (let i = 1; i < n; i++) {
    const a = route.stops[i - 1];
    const b = route.stops[i];
    totalGeomDist += Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
    cumStopDist[i] = totalGeomDist;
  }
  const stopFracs = cumStopDist.map((d) => (totalGeomDist > 0 ? d / totalGeomDist : 0));

  const elapsedToVehicle = (elapsedMs: number, originDepMs: number): ScheduledVehiclePosition => {
    // Locate stop segment via profile
    for (let i = 0; i < n - 1; i++) {
      const arrI = profile.stopArrivalOffsetsMs[i];
      const depI = profile.stopDepartureOffsetsMs[i];
      const arrNext = profile.stopArrivalOffsetsMs[i + 1];

      if (elapsedMs >= arrI && elapsedMs <= depI) {
        return {
          progress01: stopFracs[i],
          stopIndex: i,
          atStop: true,
          originDepartureMs: originDepMs,
        };
      }
      if (elapsedMs > depI && elapsedMs < arrNext) {
        const segDur = Math.max(1, arrNext - depI);
        const rawT = (elapsedMs - depI) / segDur;
        // Smooth ease-in-out acceleration/braking between stations
        const easedT = rawT < 0.12
          ? (rawT / 0.12) * (rawT / 0.12) * 0.12
          : rawT > 0.88
          ? 1 - ((1 - rawT) / 0.12) * ((1 - rawT) / 0.12) * 0.12
          : rawT;
        const progress01 = stopFracs[i] + (stopFracs[i + 1] - stopFracs[i]) * easedT;
        return {
          progress01: Math.max(0, Math.min(1, progress01)),
          stopIndex: i,
          atStop: false,
          originDepartureMs: originDepMs,
        };
      }
    }
    return {
      progress01: 1,
      stopIndex: n - 1,
      atStop: true,
      originDepartureMs: originDepMs,
    };
  };

  const active: ScheduledVehiclePosition[] = [];

  if (departureInfo && departureInfo.departuresMs.length > 0) {
    const deps = departureInfo.departuresMs;
    // Find all departures where 0 <= elapsedMs <= totalMs (wrapping UTC midnight)
    for (let i = 0; i < deps.length; i++) {
      const depMs = deps[i];
      const elapsedMs = (nowTod - depMs + DAY_MS) % DAY_MS;
      if (elapsedMs <= totalMs) {
        active.push(elapsedToVehicle(elapsedMs, depMs));
        if (active.length >= maxVehicles) break;
      }
    }
    return active;
  }

  // Deterministic schedule-aligned fallback for routes absent from departures feed
  const headwayMs = Math.max(30_000, (route.headwaySec || 180) * 1000);
  const phaseMs = hashRoutePhaseMs(route.id, headwayMs);
  const sincePhase = (((nowTod - phaseMs) % headwayMs) + headwayMs) % headwayMs;
  for (let elapsed = sincePhase; elapsed <= totalMs && active.length < maxVehicles; elapsed += headwayMs) {
    const originDepMs = (((nowTod - elapsed) % DAY_MS) + DAY_MS) % DAY_MS;
    active.push(elapsedToVehicle(elapsed, originDepMs));
  }
  return active;
}

/**
 * Formats an epoch timestamp (ms) into HH:MM using the user's local timezone.
 */
export function formatLocalTimeRu(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Converts a local `<input type="time">` value ("HH:MM") into a UTC epoch timestamp (ms)
 * on the user's current local calendar date.
 */
export function parseLocalTimeInputToEpochMs(timeHHMM: string, referenceNowMs = Date.now()): number {
  const m = timeHHMM.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return referenceNowMs;
  const hours = Math.max(0, Math.min(23, Number(m[1])));
  const minutes = Math.max(0, Math.min(59, Number(m[2])));
  const d = new Date(referenceNowMs);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

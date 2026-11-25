import type {
  DepartureInfo,
  MtrRoute,
  MtrRouteStop,
  MtrStation,
  TransportKind,
} from '../types/map';
import { isMuromorskCoordinate, resolveMuromorskTransitColor } from './mursTransitBrand';

export interface RawMtrStation {
  id: string;
  name: string;
  color: number;
  zone1?: number;
  zone2?: number;
  zone3?: number;
  connections?: string[];
}

export interface RawMtrRouteStop {
  id: string;
  x: number;
  y: number;
  z: number;
  name: string;
  dwellTime?: number;
}

export interface RawMtrRoute {
  id: string;
  name: string;
  color: number;
  number?: string;
  type?: string;
  jmeType?: string;
  circularState?: string;
  hidden?: boolean;
  stations: RawMtrRouteStop[];
  durations?: number[];
}

export interface RawMtrPayload {
  data?: {
    stations?: RawMtrStation[];
    routes?: RawMtrRoute[];
  };
}

export interface RawDeparturesPayload {
  currentTime?: number;
  data?: {
    cachedResponseTime?: number;
    departures?: Array<{
      id: string;
      departures?: Array<{
        deviation?: number;
        departures?: number[];
      }>;
    }>;
  };
}

const DEFAULT_SPEED_BLOCKS_PER_SEC: Record<TransportKind, number> = {
  metro: 24,
  rail: 28,
  tram: 13,
  trolleybus: 12,
  bus: 12.5,
  cable: 9,
  boat: 11,
  plane: 45,
};

const DEFAULT_HEADWAY_SEC: Record<TransportKind, number> = {
  metro: 120,
  tram: 210,
  trolleybus: 240,
  bus: 270,
  rail: 360,
  cable: 150,
  boat: 420,
  plane: 600,
};

export function intColorToHex(colorInt: number | undefined, fallback = '#2563EB'): string {
  if (typeof colorInt !== 'number' || Number.isNaN(colorInt)) return fallback;
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(colorInt)));
  return `#${clamped.toString(16).padStart(6, '0').toUpperCase()}`;
}

export function cleanMtrName(raw: string): { ru: string; en?: string } {
  if (!raw) return { ru: 'Без названия' };
  const parts = raw
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ru: raw.trim() };
  const ruPart = parts.find((p) => /[А-Яа-яЁё]/.test(p)) || parts[0];
  const enPart = parts.find((p) => p !== ruPart && /[A-Za-z]/.test(p));
  return {
    ru: ruPart.replace(/\s+/g, ' ').trim(),
    en: enPart ? enPart.replace(/\s+/g, ' ').trim() : undefined,
  };
}

export function classifyTransportKind(route: RawMtrRoute): TransportKind {
  const jme = (route.jmeType || route.type || '').toLowerCase();
  const name = (route.name || '').toLowerCase();

  if (jme.includes('airplane') || jme.includes('plane') || name.includes('авиа') || name.includes('самол')) {
    return 'plane';
  }
  if (jme.includes('boat') || jme.includes('ferry') || jme.includes('ship') || name.includes('паром') || name.includes('судн') || name.includes('катер') || name.includes('теплоход')) {
    return 'boat';
  }
  if (jme.includes('metro') || name.includes('линия ') || name.includes('line ')) {
    return 'metro';
  }
  if (jme.includes('cable')) {
    return 'cable';
  }
  if (jme.includes('tram') || /^\(т\d/.test(name) || name.includes('трамвай')) {
    return 'tram';
  }
  if (name.includes('(тр') || name.includes('троллейбус')) {
    return 'trolleybus';
  }
  if (jme.includes('bus') || name.includes('автобус')) {
    return 'bus';
  }
  if (jme.includes('light_rail')) {
    return 'tram';
  }
  return 'rail';
}

export function extractRouteNumber(route: RawMtrRoute, kind: TransportKind): string {
  if (route.number && route.number.trim()) {
    return route.number.trim();
  }
  const raw = route.name || '';
  if (kind === 'metro') {
    const m = raw.match(/(?:Линия|Line)\s*(\d+)/i);
    if (m) return `M${m[1]}`;
    return 'M';
  }
  const paren = raw.match(/\((?:Тр|Т|А|Э)?(\d+[А-Яа-яA-Za-z]?)\)/i);
  if (paren) return paren[1];
  const afterBar = raw.match(/\|\|\s*(\d+[А-Яа-яA-Za-z]?)/);
  if (afterBar) return afterBar[1];
  const anyNum = raw.match(/\b(\d{1,3}[А-Яа-я]?)\b/);
  if (anyNum) return anyNum[1];
  return kind === 'rail' ? 'ЖД' : '•';
}

export function inferDistrict(x: number, z: number): string {
  if (x >= 10400 && x <= 12200 && z >= -2400 && z <= -400) return 'Адмиралтейский район';
  if (x >= 9000 && x < 10400 && z >= -1200 && z <= 900) return 'Приморский район';
  if (x >= 11800 && x <= 14500 && z >= -400 && z <= 2200) return 'Железнодорожный район';
  if (x >= 11800 && x <= 15600 && z > 2200) return 'Павловский район';
  if (x >= 9200 && x <= 12600 && z < -2400) return 'Иваноостровский район';
  if (x > 12200 && z < -400) return 'Замуррецкий район';
  if (z > 900) return 'Южный промышленный район';
  return 'Муроморск';
}

const DAY_MS = 86_400_000;

export function extractServerClockOffsetMs(
  raw: RawDeparturesPayload | null | undefined,
  localNowMs = Date.now()
): number {
  const serverTime = raw?.currentTime ?? raw?.data?.cachedResponseTime;
  if (typeof serverTime !== 'number' || !Number.isFinite(serverTime) || serverTime <= 0) {
    return 0;
  }
  const offset = serverTime - localNowMs;
  // Sanity guard: if server clock differs by more than 48h (e.g. fictional in-game year like 2026+7 months),
  // keep ONLY the sub-day time-of-day offset modulo 24h so real-time departures match UTC time-of-day cleanly!
  if (Math.abs(offset) > 48 * 3_600_000) {
    const serverTod = ((serverTime % DAY_MS) + DAY_MS) % DAY_MS;
    const localTod = ((localNowMs % DAY_MS) + DAY_MS) % DAY_MS;
    let delta = serverTod - localTod;
    if (delta > DAY_MS / 2) delta -= DAY_MS;
    if (delta < -DAY_MS / 2) delta += DAY_MS;
    return delta;
  }
  return offset;
}

export function parseDeparturesPayload(raw: RawDeparturesPayload | null | undefined): Map<string, DepartureInfo> {
  const result = new Map<string, DepartureInfo>();
  const list = raw?.data?.departures;
  if (!Array.isArray(list)) return result;

  for (const item of list) {
    if (!item?.id || !Array.isArray(item.departures)) continue;
    const allDeps: number[] = [];
    let latestDeviation = 0;
    for (const group of item.departures) {
      const dev = typeof group.deviation === 'number' && Number.isFinite(group.deviation) ? group.deviation : 0;
      if (dev !== 0) latestDeviation = dev;
      if (Array.isArray(group.departures)) {
        for (const t of group.departures) {
          if (typeof t === 'number' && Number.isFinite(t)) {
            const actualMs = (((t + dev) % DAY_MS) + DAY_MS) % DAY_MS;
            allDeps.push(actualMs);
          }
        }
      }
    }
    if (allDeps.length > 0) {
      allDeps.sort((a, b) => a - b);
      // Deduplicate identical millisecond timestamps
      const uniqueDeps: number[] = [allDeps[0]];
      for (let i = 1; i < allDeps.length; i++) {
        if (allDeps[i] - uniqueDeps[uniqueDeps.length - 1] >= 1000) {
          uniqueDeps.push(allDeps[i]);
        }
      }
      result.set(item.id, {
        routeId: item.id,
        departuresMs: uniqueDeps,
        deviationMs: latestDeviation,
      });
    }
  }
  return result;
}

export function computeHeadwaySec(dep: DepartureInfo | undefined, kind: TransportKind): number {
  if (!dep || dep.departuresMs.length < 2) {
    return DEFAULT_HEADWAY_SEC[kind];
  }
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(dep.departuresMs.length, 20); i++) {
    const diff = dep.departuresMs[i] - dep.departuresMs[i - 1];
    if (diff > 5_000 && diff < 3_600_000) {
      diffs.push(diff);
    }
  }
  if (diffs.length === 0) return DEFAULT_HEADWAY_SEC[kind];
  diffs.sort((a, b) => a - b);
  const medianMs = diffs[Math.floor(diffs.length / 2)];
  return Math.max(30, Math.min(1800, Math.round(medianMs / 1000)));
}

/**
 * Detects non-passenger utility, depot turnaround, and server test / break-in ("обкатка") routes
 * so they never pollute regular tram/bus stops with bogus `rail` tags or phantom dashed rail lines.
 */
export function isUtilityOrTestRoute(rawRoute: Pick<RawMtrRoute, 'name' | 'stations' | 'hidden'>): boolean {
  if (rawRoute.hidden) return true;
  if (!Array.isArray(rawRoute.stations) || rawRoute.stations.length < 2) return true;
  const name = (rawRoute.name || '').trim();
  if (!name) return false;
  // Skip tiny depot/turnaround routes like "Оборот БР"
  if (/оборот|депо|depot|высадка$/i.test(name) && rawRoute.stations.length <= 2) {
    return true;
  }
  // Skip server test / break-in ("обкатка") and joke/dev routes that run on regular tracks with train_normal
  if (
    /обкатка|^\(о\d+\)|^тест(\s|$)|_test_|тест\s+(жд|горнооз|кривых)|открытие\s+трамвая|^!tuah/i.test(
      name
    )
  ) {
    return true;
  }
  return false;
}

const STATION_COLOR_PRECEDENCE: Record<TransportKind, number> = {
  metro: 5,
  rail: 4,
  plane: 3,
  boat: 3,
  cable: 3,
  tram: 2,
  trolleybus: 2,
  bus: 1,
};

export function parseMtrStationsAndRoutes(
  raw: RawMtrPayload | null | undefined,
  departuresMap?: Map<string, DepartureInfo>
): { stations: MtrStation[]; routes: MtrRoute[] } {
  const rawStations = raw?.data?.stations ?? [];
  const rawRoutes = raw?.data?.routes ?? [];

  const stationMeta = new Map<string, RawMtrStation>();
  for (const st of rawStations) {
    if (st?.id) stationMeta.set(st.id, st);
  }

  const routes: MtrRoute[] = [];
  const stationAcc = new Map<
    string,
    {
      id: string;
      name: string;
      englishName?: string;
      sumX: number;
      sumY: number;
      sumZ: number;
      count: number;
      color: string;
      colorPriority: number;
      kinds: Set<TransportKind>;
      routeIds: Set<string>;
    }
  >();

  for (const rawRoute of rawRoutes) {
    if (!rawRoute || isUtilityOrTestRoute(rawRoute)) continue;

    const kind = classifyTransportKind(rawRoute);
    const number = extractRouteNumber(rawRoute, kind);
    const rawHex = intColorToHex(
      rawRoute.color,
      kind === 'metro' ? '#ED1B24' : kind === 'tram' ? '#C8102E' : '#0EA5E9'
    );
    const cleanRoute = cleanMtrName(rawRoute.name || `Маршрут ${number}`);

    const stops: MtrRouteStop[] = rawRoute.stations.map((s) => {
      const meta = stationMeta.get(s.id);
      const parsedName = cleanMtrName(meta?.name || s.name || 'Станция');
      return {
        stationId: s.id,
        name: parsedName.ru,
        x: s.x,
        y: s.y,
        z: s.z,
        dwellMs: typeof s.dwellTime === 'number' && s.dwellTime > 0 ? s.dwellTime : 12_000,
      };
    });

    const midStop = stops[Math.floor(stops.length / 2)] ?? stops[0];
    const color = resolveMuromorskTransitColor(
      kind,
      rawRoute.name || cleanRoute.ru,
      number,
      rawHex,
      midStop
    );

    const segmentDurationsMs: number[] = [];
    const fallbackSpeed = DEFAULT_SPEED_BLOCKS_PER_SEC[kind];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      const rawDur =
        Array.isArray(rawRoute.durations) &&
        rawRoute.durations.length >= stops.length - 1 &&
        typeof rawRoute.durations[i] === 'number' &&
        rawRoute.durations[i] > 1000 &&
        rawRoute.durations[i] < 1_800_000
          ? rawRoute.durations[i]
          : null;

      if (rawDur !== null) {
        segmentDurationsMs.push(rawDur);
      } else {
        // Estimate realistic travel time in milliseconds (distance / speed + acceleration buffer)
        const estSec = Math.max(8, dist / fallbackSpeed + 6);
        segmentDurationsMs.push(Math.round(estSec * 1000));
      }
    }

    const headwaySec = computeHeadwaySec(departuresMap?.get(rawRoute.id), kind);

    routes.push({
      id: rawRoute.id,
      name: cleanRoute.ru,
      shortName: kind === 'metro' ? cleanRoute.ru.split('||')[0].trim() : `${number}`,
      number,
      color,
      kind,
      circular: rawRoute.circularState === 'CLOCKWISE' || rawRoute.circularState === 'ANTICLOCKWISE',
      stops,
      segmentDurationsMs,
      headwaySec,
    });

    const routeColorPri = STATION_COLOR_PRECEDENCE[kind];
    for (const stop of stops) {
      const meta = stationMeta.get(stop.stationId);
      const parsed = cleanMtrName(meta?.name || stop.name);
      const existing = stationAcc.get(stop.stationId);
      if (existing) {
        existing.sumX += stop.x;
        existing.sumY += stop.y;
        existing.sumZ += stop.z;
        existing.count += 1;
        existing.kinds.add(kind);
        existing.routeIds.add(rawRoute.id);
        if (routeColorPri > existing.colorPriority) {
          existing.color = color;
          existing.colorPriority = routeColorPri;
        } else if (
          routeColorPri === existing.colorPriority &&
          (kind === 'metro' || kind === 'rail' || isMuromorskCoordinate(stop.x, stop.z))
        ) {
          existing.color = color;
        }
      } else {
        const useRouteColor =
          kind === 'metro' || kind === 'rail' || isMuromorskCoordinate(stop.x, stop.z);
        stationAcc.set(stop.stationId, {
          id: stop.stationId,
          name: parsed.ru,
          englishName: parsed.en,
          sumX: stop.x,
          sumY: stop.y,
          sumZ: stop.z,
          count: 1,
          color: useRouteColor ? color : intColorToHex(meta?.color, color),
          colorPriority: routeColorPri,
          kinds: new Set([kind]),
          routeIds: new Set([rawRoute.id]),
        });
      }
    }
  }

  const stations: MtrStation[] = Array.from(stationAcc.values()).map((acc) => {
    const x = Math.round(acc.sumX / acc.count);
    const y = Math.round(acc.sumY / acc.count);
    const z = Math.round(acc.sumZ / acc.count);
    return {
      id: acc.id,
      name: acc.name,
      englishName: acc.englishName,
      x,
      y,
      z,
      color: acc.color,
      kinds: Array.from(acc.kinds),
      routeIds: Array.from(acc.routeIds),
      district: inferDistrict(x, z),
    };
  });

  return { stations, routes };
}

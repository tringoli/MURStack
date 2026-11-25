import type { MtrRoute, MtrStation, TransportKind } from '../types/map';

/**
 * Official MURS Wiki transit colors from https://wiki.murs-mc.ru/wiki/Шаблон:Линия
 */
export const MUROMORSK_WIKI_COLORS = {
  // Муроморский метрополитен
  metroBrand: '#007FDE',
  m1: '#ED1B24', // Невско-Заводская линия (М1)
  m2: '#009A49', // Марининско-Павловская линия (М2)
  m3: '#0078BF', // Замуррецкая линия (М3)
  m4: '#F58220', // Калининско-Мурская линия (М4)
  // Мурская железная дорога
  railNorth: '#2CA05A', // Св — Северное направление
  railEast: '#009999', // Вв — Восточное направление
  // Наземный транспорт Муроморска
  tram: '#C8102E', // Трамвай (Т1–Т16)
  trolleybus: '#00838F', // Троллейбус (Тр1–Тр14)
  bus: '#E65100', // Автобус (А51–А75, АК)
} as const;

/**
 * Exact official vector path for the Muromorsk Metro emblem extracted from
 * https://wiki.murs-mc.ru/wiki/Муроморский_метрополитен (viewBox 0 0 148 110).
 */
export const MUROMORSK_METRO_EMBLEM_PATH =
  'M105.789 0.969727L147.469 108.314L147.733 108.996H112.059L111.935 108.678L97.7422 72.2344L74.6797 107.98L73.9736 109.075V109.407L73.8662 109.241L73.7598 109.407V109.075L73.0537 107.98L49.9912 72.2344L35.7988 108.678L35.6748 108.996H0L0.264648 108.314L41.9443 0.969727L42.3203 0L42.8428 0.899414L73.8662 54.3066L104.891 0.899414L105.413 0L105.789 0.969727Z';

export const MUROMORSK_METRO_EMBLEM_VIEWBOX = {
  width: 147.733,
  height: 109.407,
};

let cachedEmblemPath2D: Path2D | null = null;

function getEmblemPath2D(): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  if (!cachedEmblemPath2D) {
    cachedEmblemPath2D = new Path2D(MUROMORSK_METRO_EMBLEM_PATH);
  }
  return cachedEmblemPath2D;
}

const MUROMORSK_DISTRICTS = new Set([
  'Муроморск',
  'Адмиралтейский район',
  'Приморский район',
  'Железнодорожный район',
  'Павловский район',
  'Иваноостровский район',
  'Замуррецкий район',
  'Южный промышленный район',
]);

/**
 * Checks whether a Minecraft (X, Z) coordinate falls within the Muromorsk metropolitan area
 * (distinct from other cities on the MURS server such as Красноградск or Шикса).
 */
export function isMuromorskCoordinate(x: number, z: number): boolean {
  return x >= 6800 && x <= 18500 && z >= -6500 && z <= 5500;
}

/**
 * Checks whether a station belongs to the Muromorsk Metro (Муроморский метрополитен).
 */
export function isMuromorskMetroStation(station: Pick<MtrStation, 'x' | 'z' | 'kinds' | 'district'>): boolean {
  if (!station.kinds.includes('metro')) return false;
  if (isMuromorskCoordinate(station.x, station.z)) return true;
  return Boolean(station.district && MUROMORSK_DISTRICTS.has(station.district));
}

/**
 * Checks whether a transit route belongs to the Muromorsk Metro (Муроморский метрополитен).
 */
export function isMuromorskMetroRoute(route: Pick<MtrRoute, 'kind' | 'stops'>): boolean {
  if (route.kind !== 'metro') return false;
  if (route.stops.length === 0) return true;
  return route.stops.some((s) => isMuromorskCoordinate(s.x, s.z));
}

/**
 * Resolves the authentic official MURS Wiki color from `Шаблон:Линия` for Muromorsk
 * public transit routes & lines, while preserving raw server colors for other cities/special modes.
 */
export function resolveMuromorskTransitColor(
  kind: TransportKind,
  routeName: string,
  routeNumber: string,
  fallbackHex: string,
  centerCoord?: { x: number; z: number }
): string {
  const inMuromorsk = centerCoord ? isMuromorskCoordinate(centerCoord.x, centerCoord.z) : true;
  if (!inMuromorsk) return fallbackHex;

  const text = `${routeNumber} ${routeName}`.toLowerCase();

  if (kind === 'metro') {
    if (
      /\b[мm]1\b|линия\s*1|line\s*1|невско[-\s]?заводск|красн/i.test(text)
    ) {
      return MUROMORSK_WIKI_COLORS.m1;
    }
    if (
      /\b[мm]2\b|линия\s*2|line\s*2|марининско[-\s]?павловск|зелён|зелен/i.test(text)
    ) {
      return MUROMORSK_WIKI_COLORS.m2;
    }
    if (
      /\b[мm]3\b|линия\s*3|line\s*3|замуррецк|син/i.test(text)
    ) {
      return MUROMORSK_WIKI_COLORS.m3;
    }
    if (
      /\b[мm]4\b|линия\s*4|line\s*4|калининско[-\s]?мурск|оранжев/i.test(text)
    ) {
      return MUROMORSK_WIKI_COLORS.m4;
    }
    return fallbackHex || MUROMORSK_WIKI_COLORS.metroBrand;
  }

  if (kind === 'rail') {
    if (/восточн|\bвв\b|вост\./i.test(text)) {
      return MUROMORSK_WIKI_COLORS.railEast;
    }
    if (/северн|\bсв\b|сев\.|мурская\s*ж/i.test(text)) {
      return MUROMORSK_WIKI_COLORS.railNorth;
    }
    return MUROMORSK_WIKI_COLORS.railNorth;
  }

  if (kind === 'tram') {
    return MUROMORSK_WIKI_COLORS.tram;
  }

  if (kind === 'trolleybus') {
    return MUROMORSK_WIKI_COLORS.trolleybus;
  }

  if (kind === 'bus') {
    return MUROMORSK_WIKI_COLORS.bus;
  }

  return fallbackHex;
}

/**
 * Draws the official unified blue Muromorsk Metro emblem (https://wiki.murs-mc.ru/wiki/Муроморский_метрополитен)
 * onto a 2D Canvas context inside a crisp circular station medallion.
 */
export function drawMuromorskMetroEmblem(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  radius: number,
  _lineColor: string = MUROMORSK_WIKI_COLORS.metroBrand,
  options: { isSelected?: boolean; isHovered?: boolean; isDark?: boolean } = {}
): void {
  const { isSelected = false, isHovered = false, isDark = false } = options;
  const brandBlue = MUROMORSK_WIKI_COLORS.metroBrand;

  ctx.save();
  ctx.translate(sx, sy);

  // Subtle highlight halo on selection or hover
  if (isSelected || isHovered) {
    ctx.beginPath();
    ctx.arc(0, 0, radius + 3.2, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? 'rgba(255, 204, 0, 0.45)' : 'rgba(0, 127, 222, 0.28)';
    ctx.fill();
  }

  // Outer medallion: crisp white/dark surface with unified brand blue ring
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? '#181B22' : '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = isSelected ? 2.6 : 1.9;
  ctx.strokeStyle = isSelected ? '#FFCC00' : brandBlue;
  ctx.stroke();

  // Official sharp-angled unified blue Muromorsk Metro "М" emblem centered inside the circle
  const p2d = getEmblemPath2D();
  if (p2d) {
    const targetW = radius * 1.32;
    const scale = targetW / MUROMORSK_METRO_EMBLEM_VIEWBOX.width;
    const drawW = MUROMORSK_METRO_EMBLEM_VIEWBOX.width * scale;
    const drawH = MUROMORSK_METRO_EMBLEM_VIEWBOX.height * scale;

    ctx.save();
    ctx.translate(-drawW * 0.5, -drawH * 0.52);
    ctx.scale(scale, scale);
    ctx.fillStyle = brandBlue;
    ctx.fill(p2d);
    ctx.restore();
  } else {
    // Fallback vector geometry if Path2D is unavailable
    ctx.fillStyle = brandBlue;
    ctx.font = `800 ${Math.round(radius * 1.1)}px Manrope, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('М', 0, 0.5);
  }

  ctx.restore();
}

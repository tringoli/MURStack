import type { MtrStation, TransportKind } from '../types/map';
import {
  drawMuromorskMetroEmblem,
  isMuromorskMetroStation,
  MUROMORSK_WIKI_COLORS,
} from './mursTransitBrand';

export type StopSymbolKind =
  | 'muromorsk-metro'
  | 'muromorsk-metro-rail'
  | 'rail-metro'
  | 'metro'
  | 'rail'
  | 'bus-tram'
  | 'tram'
  | 'trolleybus'
  | 'bus'
  | 'other';

export interface ResolvedStopSymbol {
  symbol: StopSymbolKind;
  primaryColor: string;
  secondaryColor?: string;
  isMuromorskMetro: boolean;
  labelRu: string;
}

/**
 * Resolves the stylish transit stop/station icon kind, including combined hubs
 * (`bus+tram`, `rail+metro`) while strictly preserving unique emblems such as
 * the official Muromorsk Metro emblem (Муроморский метрополитен).
 */
export function resolveStationStopSymbol(
  station: Pick<MtrStation, 'id' | 'name' | 'x' | 'z' | 'color' | 'kinds' | 'district'>,
  nearbyKinds: TransportKind[] = []
): ResolvedStopSymbol {
  const allKinds = new Set<TransportKind>([...station.kinds, ...nearbyKinds]);
  const hasMetro = allKinds.has('metro');
  const hasRail = allKinds.has('rail');
  const hasBus = allKinds.has('bus');
  const hasTram = allKinds.has('tram');
  const hasTrolleybus = allKinds.has('trolleybus');

  const isMuromorskMetro = hasMetro && isMuromorskMetroStation({
    x: station.x,
    z: station.z,
    kinds: ['metro'],
    district: station.district,
  });

  if (hasMetro && hasRail) {
    return {
      symbol: isMuromorskMetro ? 'muromorsk-metro-rail' : 'rail-metro',
      primaryColor: isMuromorskMetro
        ? MUROMORSK_WIKI_COLORS.metroBrand
        : station.color || MUROMORSK_WIKI_COLORS.metroBrand,
      secondaryColor: MUROMORSK_WIKI_COLORS.railNorth,
      isMuromorskMetro,
      labelRu: isMuromorskMetro
        ? 'Пересадка: Муроморский метрополитен + ЖД'
        : 'Пересадка: Метро + ЖД',
    };
  }

  if (hasMetro) {
    return {
      symbol: isMuromorskMetro ? 'muromorsk-metro' : 'metro',
      primaryColor: isMuromorskMetro
        ? MUROMORSK_WIKI_COLORS.metroBrand
        : station.color || MUROMORSK_WIKI_COLORS.metroBrand,
      isMuromorskMetro,
      labelRu: isMuromorskMetro ? 'Муроморский метрополитен' : 'Станция метро',
    };
  }

  if (hasRail) {
    return {
      symbol: 'rail',
      primaryColor: station.color || MUROMORSK_WIKI_COLORS.railNorth,
      isMuromorskMetro: false,
      labelRu: 'Железнодорожная станция',
    };
  }

  if (hasBus && hasTram) {
    return {
      symbol: 'bus-tram',
      primaryColor: MUROMORSK_WIKI_COLORS.bus,
      secondaryColor: MUROMORSK_WIKI_COLORS.tram,
      isMuromorskMetro: false,
      labelRu: 'Остановка автобуса и трамвая',
    };
  }

  if (hasTram) {
    return {
      symbol: 'tram',
      primaryColor: station.color || MUROMORSK_WIKI_COLORS.tram,
      isMuromorskMetro: false,
      labelRu: 'Трамвайная остановка',
    };
  }

  if (hasTrolleybus) {
    return {
      symbol: 'trolleybus',
      primaryColor: station.color || MUROMORSK_WIKI_COLORS.trolleybus,
      isMuromorskMetro: false,
      labelRu: 'Троллейбусная остановка',
    };
  }

  if (hasBus) {
    return {
      symbol: 'bus',
      primaryColor: station.color || MUROMORSK_WIKI_COLORS.bus,
      isMuromorskMetro: false,
      labelRu: 'Автобусная остановка',
    };
  }

  return {
    symbol: 'other',
    primaryColor: station.color || '#475569',
    isMuromorskMetro: false,
    labelRu: 'Остановка транспорта',
  };
}

/**
 * Finds complementary transit modes served by tightly colocated transfer stops
 * (within ~26m, e.g. a rail station next to a metro vestibule or a shared bus+tram stop).
 */
export function buildStationCombinedModesMap(
  stations: MtrStation[],
  radiusBlocks = 26
): Map<string, TransportKind[]> {
  const out = new Map<string, TransportKind[]>();
  const CELL = 32;
  const grid = new Map<string, MtrStation[]>();

  for (const st of stations) {
    const key = `${Math.floor(st.x / CELL)}_${Math.floor(st.z / CELL)}`;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(st);
  }

  for (const st of stations) {
    const cx = Math.floor(st.x / CELL);
    const cz = Math.floor(st.z / CELL);
    const extra = new Set<TransportKind>();
    const hasMetro = st.kinds.includes('metro');
    const hasRail = st.kinds.includes('rail');
    const hasBus = st.kinds.includes('bus');
    const hasTram = st.kinds.includes('tram');

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(`${cx + dx}_${cz + dz}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other.id === st.id) continue;
          const d = Math.hypot(other.x - st.x, other.z - st.z);
          if (d > radiusBlocks) continue;
          // Combine rail+metro hubs or bus+tram shared stops
          if ((hasMetro && other.kinds.includes('rail')) || (hasRail && other.kinds.includes('metro'))) {
            if (other.kinds.includes('rail')) extra.add('rail');
            if (other.kinds.includes('metro')) extra.add('metro');
          }
          if ((hasBus && other.kinds.includes('tram')) || (hasTram && other.kinds.includes('bus'))) {
            if (other.kinds.includes('bus')) extra.add('bus');
            if (other.kinds.includes('tram')) extra.add('tram');
          }
        }
      }
    }

    if (extra.size > 0) {
      out.set(st.id, Array.from(extra));
    }
  }

  return out;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * Draws a crisp vector transit vehicle/station glyph centered at (cx, cy) scaled to `s` (half-size).
 */
function drawVehicleGlyph(
  ctx: CanvasRenderingContext2D,
  kind: 'bus' | 'tram' | 'trolleybus' | 'rail' | 'metro',
  cx: number,
  cy: number,
  s: number,
  fg: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'metro') {
    // Stylish geometric winged "M" (for non-Muromorsk metro systems)
    ctx.lineWidth = Math.max(1.3, s * 0.34);
    ctx.beginPath();
    ctx.moveTo(-s * 0.72, s * 0.52);
    ctx.lineTo(-s * 0.44, -s * 0.56);
    ctx.lineTo(0, s * 0.14);
    ctx.lineTo(s * 0.44, -s * 0.56);
    ctx.lineTo(s * 0.72, s * 0.52);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (kind === 'bus') {
    // Sleek bus front silhouette: body + panoramic windshield + twin headlights + wheels
    drawRoundedRectPath(ctx, -s * 0.58, -s * 0.58, s * 1.16, s * 1.02, s * 0.22);
    ctx.fill();
    // Windshield cutout
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    drawRoundedRectPath(ctx, -s * 0.42, -s * 0.42, s * 0.84, s * 0.44, s * 0.1);
    ctx.fill();
    // Headlights cutouts
    ctx.beginPath();
    ctx.arc(-s * 0.32, s * 0.22, s * 0.11, 0, Math.PI * 2);
    ctx.arc(s * 0.32, s * 0.22, s * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Wheels
    ctx.fillRect(-s * 0.46, s * 0.42, s * 0.22, s * 0.22);
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.22, s * 0.22);
    ctx.restore();
    return;
  }

  if (kind === 'tram') {
    // Roof pantograph diamond + sleek tram front + rail runners
    ctx.lineWidth = Math.max(1.0, s * 0.17);
    ctx.beginPath();
    ctx.moveTo(-s * 0.28, -s * 0.82);
    ctx.lineTo(s * 0.28, -s * 0.82);
    ctx.moveTo(0, -s * 0.82);
    ctx.lineTo(-s * 0.2, -s * 0.64);
    ctx.lineTo(0, -s * 0.48);
    ctx.lineTo(s * 0.2, -s * 0.64);
    ctx.closePath();
    ctx.stroke();

    drawRoundedRectPath(ctx, -s * 0.54, -s * 0.48, s * 1.08, s * 0.94, s * 0.22);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    drawRoundedRectPath(ctx, -s * 0.38, -s * 0.34, s * 0.76, s * 0.4, s * 0.08);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, s * 0.24, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Rails below tram
    ctx.lineWidth = Math.max(1.0, s * 0.17);
    ctx.beginPath();
    ctx.moveTo(-s * 0.34, s * 0.48);
    ctx.lineTo(-s * 0.48, s * 0.74);
    ctx.moveTo(s * 0.34, s * 0.48);
    ctx.lineTo(s * 0.48, s * 0.74);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (kind === 'trolleybus') {
    // Twin diagonal overhead trolley poles + sleek bus front
    ctx.lineWidth = Math.max(1.0, s * 0.17);
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, -s * 0.48);
    ctx.lineTo(-s * 0.46, -s * 0.84);
    ctx.moveTo(s * 0.18, -s * 0.48);
    ctx.lineTo(s * 0.46, -s * 0.84);
    ctx.stroke();

    drawRoundedRectPath(ctx, -s * 0.56, -s * 0.48, s * 1.12, s * 0.96, s * 0.22);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    drawRoundedRectPath(ctx, -s * 0.4, -s * 0.34, s * 0.8, s * 0.4, s * 0.08);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-s * 0.3, s * 0.24, s * 0.1, 0, Math.PI * 2);
    ctx.arc(s * 0.3, s * 0.24, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillRect(-s * 0.44, s * 0.46, s * 0.2, s * 0.2);
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.2, s * 0.2);
    ctx.restore();
    return;
  }

  // 'rail': aerodynamic suburban/high-speed train front + track sleepers
  drawRoundedRectPath(ctx, -s * 0.54, -s * 0.64, s * 1.08, s * 1.06, s * 0.32);
  ctx.fill();

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  drawRoundedRectPath(ctx, -s * 0.38, -s * 0.44, s * 0.76, s * 0.38, s * 0.12);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-s * 0.28, s * 0.18, s * 0.11, 0, Math.PI * 2);
  ctx.arc(s * 0.28, s * 0.18, s * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Converging rails + crosstie
  ctx.lineWidth = Math.max(1.0, s * 0.18);
  ctx.beginPath();
  ctx.moveTo(-s * 0.34, s * 0.44);
  ctx.lineTo(-s * 0.56, s * 0.78);
  ctx.moveTo(s * 0.34, s * 0.44);
  ctx.lineTo(s * 0.56, s * 0.78);
  ctx.moveTo(-s * 0.42, s * 0.64);
  ctx.lineTo(s * 0.42, s * 0.64);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws a crisp standalone glyph onto an offscreen mini-sprite or directly with white cutouts
 * without erasing the underlying map canvas (safe destination-out inside solid pill!).
 */
function drawSafeVehicleGlyph(
  ctx: CanvasRenderingContext2D,
  kind: 'bus' | 'tram' | 'trolleybus' | 'rail' | 'metro',
  cx: number,
  cy: number,
  s: number,
  fg: string,
  cutoutBg: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'metro') {
    ctx.lineWidth = Math.max(1.5, s * 0.34);
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, s * 0.5);
    ctx.lineTo(-s * 0.44, -s * 0.54);
    ctx.lineTo(0, s * 0.12);
    ctx.lineTo(s * 0.44, -s * 0.54);
    ctx.lineTo(s * 0.7, s * 0.5);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (kind === 'bus') {
    drawRoundedRectPath(ctx, -s * 0.58, -s * 0.56, s * 1.16, s * 1.0, s * 0.22);
    ctx.fill();
    ctx.fillStyle = cutoutBg;
    drawRoundedRectPath(ctx, -s * 0.42, -s * 0.4, s * 0.84, s * 0.42, s * 0.1);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-s * 0.3, s * 0.22, s * 0.11, 0, Math.PI * 2);
    ctx.arc(s * 0.3, s * 0.22, s * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillRect(-s * 0.46, s * 0.42, s * 0.22, s * 0.22);
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.22, s * 0.22);
    ctx.restore();
    return;
  }

  if (kind === 'tram') {
    ctx.lineWidth = Math.max(1.0, s * 0.17);
    ctx.beginPath();
    ctx.moveTo(-s * 0.28, -s * 0.82);
    ctx.lineTo(s * 0.28, -s * 0.82);
    ctx.moveTo(0, -s * 0.82);
    ctx.lineTo(-s * 0.2, -s * 0.64);
    ctx.lineTo(0, -s * 0.48);
    ctx.lineTo(s * 0.2, -s * 0.64);
    ctx.closePath();
    ctx.stroke();

    drawRoundedRectPath(ctx, -s * 0.54, -s * 0.48, s * 1.08, s * 0.94, s * 0.22);
    ctx.fill();

    ctx.fillStyle = cutoutBg;
    drawRoundedRectPath(ctx, -s * 0.38, -s * 0.34, s * 0.76, s * 0.4, s * 0.08);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, s * 0.24, s * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = fg;
    ctx.lineWidth = Math.max(1.0, s * 0.17);
    ctx.beginPath();
    ctx.moveTo(-s * 0.34, s * 0.48);
    ctx.lineTo(-s * 0.48, s * 0.74);
    ctx.moveTo(s * 0.34, s * 0.48);
    ctx.lineTo(s * 0.48, s * 0.74);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (kind === 'trolleybus') {
    ctx.lineWidth = Math.max(1.0, s * 0.17);
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, -s * 0.48);
    ctx.lineTo(-s * 0.46, -s * 0.84);
    ctx.moveTo(s * 0.18, -s * 0.48);
    ctx.lineTo(s * 0.46, -s * 0.84);
    ctx.stroke();

    drawRoundedRectPath(ctx, -s * 0.56, -s * 0.48, s * 1.12, s * 0.96, s * 0.22);
    ctx.fill();

    ctx.fillStyle = cutoutBg;
    drawRoundedRectPath(ctx, -s * 0.4, -s * 0.34, s * 0.8, s * 0.4, s * 0.08);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-s * 0.3, s * 0.24, s * 0.1, 0, Math.PI * 2);
    ctx.arc(s * 0.3, s * 0.24, s * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.fillRect(-s * 0.44, s * 0.46, s * 0.2, s * 0.2);
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.2, s * 0.2);
    ctx.restore();
    return;
  }

  // rail
  drawRoundedRectPath(ctx, -s * 0.54, -s * 0.64, s * 1.08, s * 1.06, s * 0.32);
  ctx.fill();

  ctx.fillStyle = cutoutBg;
  drawRoundedRectPath(ctx, -s * 0.38, -s * 0.44, s * 0.76, s * 0.38, s * 0.12);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-s * 0.28, s * 0.18, s * 0.11, 0, Math.PI * 2);
  ctx.arc(s * 0.28, s * 0.18, s * 0.11, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(1.0, s * 0.18);
  ctx.beginPath();
  ctx.moveTo(-s * 0.34, s * 0.44);
  ctx.lineTo(-s * 0.56, s * 0.78);
  ctx.moveTo(s * 0.34, s * 0.44);
  ctx.lineTo(s * 0.56, s * 0.78);
  ctx.moveTo(-s * 0.42, s * 0.64);
  ctx.lineTo(s * 0.42, s * 0.64);
  ctx.stroke();

  ctx.restore();
}

// Keep unused helper reference suppressed cleanly
void drawVehicleGlyph;

/**
 * Returns the exact screen-space half-width and half-height (in CSS px) occupied by a transit stop symbol
 * so Pass 9 can test and reserve icon bounding boxes in `ScreenLabelGrid` before drawing.
 */
export function getTransitStopSymbolHalfExtents(
  resolved: ResolvedStopSymbol,
  options: {
    zoom: number;
    isSelected?: boolean;
    isHovered?: boolean;
  }
): { halfW: number; halfH: number } {
  const { zoom, isSelected = false, isHovered = false } = options;

  if (resolved.symbol === 'muromorsk-metro') {
    const r = isSelected ? 11.4 : isHovered ? 10.6 : 9.6;
    return { halfW: r + 3, halfH: r + 2 };
  }
  if (resolved.symbol === 'muromorsk-metro-rail') {
    const r = isSelected ? 10.8 : isHovered ? 10.1 : 9.2;
    const offset = r * 0.88;
    return { halfW: offset + r + 4, halfH: r + 2.5 };
  }
  if (resolved.symbol === 'rail-metro') {
    const r = isSelected ? 10.2 : isHovered ? 9.5 : 8.6;
    return { halfW: r * 1.7 + 3, halfH: r * 1.05 + 2 };
  }
  if (resolved.symbol === 'metro') {
    const r = isSelected ? 10.5 : isHovered ? 9.8 : 8.8;
    return { halfW: r + 3, halfH: r + 2 };
  }
  if (resolved.symbol === 'rail') {
    const r = isSelected ? 9.8 : isHovered ? 9.1 : zoom >= 0.42 ? 8.2 : 6.8;
    return { halfW: r + 3, halfH: r + 2 };
  }
  if (resolved.symbol === 'bus-tram') {
    if (zoom < 0.34 && !isSelected && !isHovered) {
      return { halfW: 7.6, halfH: 6.5 };
    }
    const s = isSelected ? 8.8 : isHovered ? 8.2 : 7.4;
    return { halfW: s * 1.78 + 3, halfH: s * 1.05 + 2 };
  }
  if (resolved.symbol === 'bus' || resolved.symbol === 'tram' || resolved.symbol === 'trolleybus') {
    if (zoom < 0.35 && !isSelected && !isHovered) {
      return { halfW: 7, halfH: 6 };
    }
    const r = isSelected ? 8.8 : isHovered ? 8.2 : 7.2;
    return { halfW: r + 3, halfH: r + 2 };
  }
  const r = isSelected ? 5.8 : isHovered ? 5.2 : 4.0;
  return { halfW: r + 3, halfH: r + 2 };
}

/**
 * Renders a stylish cartographic transit stop or station symbol on the 2D map canvas.
 * Preserves authentic unique emblems (like Muromorsk Metro) and supports combined hubs
 * (`bus+tram`, `rail+metro`).
 * Returns the horizontal half-width occupied by the icon so labels can align cleanly.
 */
export function drawTransitStopSymbolOnCanvas(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  resolved: ResolvedStopSymbol,
  options: {
    zoom: number;
    isSelected?: boolean;
    isHovered?: boolean;
    isDark?: boolean;
  }
): number {
  const { zoom, isSelected = false, isHovered = false, isDark = false } = options;
  const surfaceBg = isDark ? '#181B22' : '#FFFFFF';

  // 1. Authentic Muromorsk Metro (standalone) — never replaced!
  if (resolved.symbol === 'muromorsk-metro') {
    const r = isSelected ? 11.4 : isHovered ? 10.6 : 9.6;
    drawMuromorskMetroEmblem(ctx, sx, sy, r, resolved.primaryColor, {
      isSelected,
      isHovered,
      isDark,
    });
    return r + 3;
  }

  // 2. Combined Muromorsk Metro + Rail: authentic Muromorsk Metro emblem + crisp attached Rail medallion
  if (resolved.symbol === 'muromorsk-metro-rail') {
    const r = isSelected ? 10.8 : isHovered ? 10.1 : 9.2;
    const offset = r * 0.88;
    const railColor = resolved.secondaryColor || MUROMORSK_WIKI_COLORS.railNorth;

    ctx.save();
    // Connecting pill bridge behind both medallions
    drawRoundedRectPath(ctx, sx - offset - r - 1.5, sy - r - 1.5, (offset + r + 1.5) * 2, (r + 1.5) * 2, r + 1.5);
    ctx.fillStyle = surfaceBg;
    ctx.fill();
    ctx.lineWidth = isSelected ? 2.2 : 1.5;
    ctx.strokeStyle = isSelected ? '#FFCC00' : isDark ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.16)';
    ctx.stroke();

    // Left: Authentic Muromorsk Metro emblem
    drawMuromorskMetroEmblem(ctx, sx - offset * 0.92, sy, r * 0.94, resolved.primaryColor, {
      isSelected: false,
      isHovered,
      isDark,
    });

    // Right: Crisp Rail badge
    const rx = sx + offset * 0.92;
    ctx.beginPath();
    ctx.arc(rx, sy, r * 0.94, 0, Math.PI * 2);
    ctx.fillStyle = railColor;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = surfaceBg;
    ctx.stroke();
    drawSafeVehicleGlyph(ctx, 'rail', rx, sy, r * 0.56, '#FFFFFF', railColor);
    ctx.restore();
    return offset + r + 4;
  }

  // 3. Generic Combined Rail + Metro (non-Muromorsk cities)
  if (resolved.symbol === 'rail-metro') {
    const r = isSelected ? 10.2 : isHovered ? 9.5 : 8.6;
    const w = r * 3.4;
    const h = r * 2.05;
    const railColor = resolved.secondaryColor || MUROMORSK_WIKI_COLORS.railNorth;

    ctx.save();
    if (isSelected || isHovered) {
      drawRoundedRectPath(ctx, sx - w * 0.5 - 2.5, sy - h * 0.5 - 2.5, w + 5, h + 5, (h + 5) * 0.5);
      ctx.fillStyle = isSelected ? 'rgba(255,204,0,0.45)' : 'rgba(59,130,246,0.28)';
      ctx.fill();
    }
    drawRoundedRectPath(ctx, sx - w * 0.5, sy - h * 0.5, w, h, h * 0.5);
    ctx.fillStyle = surfaceBg;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = isSelected ? '#FFCC00' : isDark ? '#334155' : '#CBD5E1';
    ctx.stroke();

    // Left circle: Metro
    ctx.beginPath();
    ctx.arc(sx - r * 0.78, sy, r * 0.84, 0, Math.PI * 2);
    ctx.fillStyle = resolved.primaryColor;
    ctx.fill();
    drawSafeVehicleGlyph(ctx, 'metro', sx - r * 0.78, sy, r * 0.54, '#FFFFFF', resolved.primaryColor);

    // Right circle: Rail
    ctx.beginPath();
    ctx.arc(sx + r * 0.78, sy, r * 0.84, 0, Math.PI * 2);
    ctx.fillStyle = railColor;
    ctx.fill();
    drawSafeVehicleGlyph(ctx, 'rail', sx + r * 0.78, sy, r * 0.52, '#FFFFFF', railColor);
    ctx.restore();
    return w * 0.5 + 3;
  }

  // 4. Generic Metro (non-Muromorsk)
  if (resolved.symbol === 'metro') {
    const r = isSelected ? 10.5 : isHovered ? 9.8 : 8.8;
    ctx.save();
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? 'rgba(255,204,0,0.45)' : 'rgba(59,130,246,0.28)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = resolved.primaryColor;
    ctx.fill();
    ctx.lineWidth = isSelected ? 2.4 : 1.8;
    ctx.strokeStyle = surfaceBg;
    ctx.stroke();
    drawSafeVehicleGlyph(ctx, 'metro', sx, sy, r * 0.58, '#FFFFFF', resolved.primaryColor);
    ctx.restore();
    return r + 3;
  }

  // 5. Rail Station (ЖД / электричка)
  if (resolved.symbol === 'rail') {
    const r = isSelected ? 9.8 : isHovered ? 9.1 : zoom >= 0.42 ? 8.2 : 6.8;
    ctx.save();
    if (isSelected || isHovered) {
      drawRoundedRectPath(ctx, sx - r - 2.6, sy - r - 2.6, (r + 2.6) * 2, (r + 2.6) * 2, 6);
      ctx.fillStyle = isSelected ? 'rgba(255,204,0,0.45)' : 'rgba(44,160,90,0.28)';
      ctx.fill();
    }
    drawRoundedRectPath(ctx, sx - r, sy - r, r * 2, r * 2, 5);
    ctx.fillStyle = resolved.primaryColor;
    ctx.fill();
    ctx.lineWidth = isSelected ? 2.2 : 1.6;
    ctx.strokeStyle = surfaceBg;
    ctx.stroke();
    drawSafeVehicleGlyph(ctx, 'rail', sx, sy, r * 0.62, '#FFFFFF', resolved.primaryColor);
    ctx.restore();
    return r + 3;
  }

  // 6. Combined Bus + Tram stop (compact dot at low zoom, crisp dual icon capsule at zoom >= 0.34)
  if (resolved.symbol === 'bus-tram') {
    if (zoom < 0.34 && !isSelected && !isHovered) {
      const r = 4.6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, r, Math.PI * 0.5, Math.PI * 1.5);
      ctx.fillStyle = resolved.primaryColor;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, r, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.fillStyle = resolved.secondaryColor || MUROMORSK_WIKI_COLORS.tram;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = surfaceBg;
      ctx.stroke();
      ctx.restore();
      return r + 3;
    }

    const s = isSelected ? 8.8 : isHovered ? 8.2 : 7.4;
    const w = s * 3.55;
    const h = s * 2.05;
    const busCol = resolved.primaryColor;
    const tramCol = resolved.secondaryColor || MUROMORSK_WIKI_COLORS.tram;

    ctx.save();
    if (isSelected || isHovered) {
      drawRoundedRectPath(ctx, sx - w * 0.5 - 2.2, sy - h * 0.5 - 2.2, w + 4.4, h + 4.4, 7);
      ctx.fillStyle = isSelected ? 'rgba(255,204,0,0.45)' : 'rgba(230,81,0,0.28)';
      ctx.fill();
    }
    // Outer white capsule border
    drawRoundedRectPath(ctx, sx - w * 0.5, sy - h * 0.5, w, h, 5.5);
    ctx.fillStyle = surfaceBg;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = isSelected ? '#FFCC00' : isDark ? '#334155' : '#CBD5E1';
    ctx.stroke();

    // Left half: Bus tile
    drawRoundedRectPath(ctx, sx - w * 0.5 + 1.5, sy - h * 0.5 + 1.5, w * 0.5 - 2.2, h - 3, 4);
    ctx.fillStyle = busCol;
    ctx.fill();
    drawSafeVehicleGlyph(ctx, 'bus', sx - w * 0.25 + 0.3, sy, s * 0.56, '#FFFFFF', busCol);

    // Right half: Tram tile
    drawRoundedRectPath(ctx, sx + 0.7, sy - h * 0.5 + 1.5, w * 0.5 - 2.2, h - 3, 4);
    ctx.fillStyle = tramCol;
    ctx.fill();
    drawSafeVehicleGlyph(ctx, 'tram', sx + w * 0.25 - 0.3, sy, s * 0.56, '#FFFFFF', tramCol);

    ctx.restore();
    return w * 0.5 + 3;
  }

  // 7. Single Surface Transit Stop (Bus / Tram / Trolleybus)
  if (resolved.symbol === 'bus' || resolved.symbol === 'tram' || resolved.symbol === 'trolleybus') {
    if (zoom < 0.35 && !isSelected && !isHovered) {
      const r = 4.0;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = surfaceBg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = resolved.primaryColor;
      ctx.stroke();
      ctx.restore();
      return r + 3;
    }

    const r = isSelected ? 8.8 : isHovered ? 8.2 : 7.2;
    ctx.save();
    if (isSelected || isHovered) {
      drawRoundedRectPath(ctx, sx - r - 2.4, sy - r - 2.4, (r + 2.4) * 2, (r + 2.4) * 2, 6);
      ctx.fillStyle = isSelected ? 'rgba(255,204,0,0.45)' : 'rgba(59,130,246,0.25)';
      ctx.fill();
    }
    drawRoundedRectPath(ctx, sx - r, sy - r, r * 2, r * 2, 4.5);
    ctx.fillStyle = resolved.primaryColor;
    ctx.fill();
    ctx.lineWidth = isSelected ? 2 : 1.5;
    ctx.strokeStyle = surfaceBg;
    ctx.stroke();

    drawSafeVehicleGlyph(ctx, resolved.symbol, sx, sy, r * 0.62, '#FFFFFF', resolved.primaryColor);
    ctx.restore();
    return r + 3;
  }

  // 8. Other transport modes (cable / boat / plane)
  const r = isSelected ? 5.8 : isHovered ? 5.2 : 4.0;
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = surfaceBg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = resolved.primaryColor;
  ctx.stroke();
  ctx.restore();
  return r + 3;
}

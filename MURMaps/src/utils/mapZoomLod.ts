import type { MapPlaceLabel, MtrStation, PoiIconKind, RoadClass, SettlementTier } from '../types/map';

export type { MapPlaceLabel, SettlementTier };

/**
 * Online-maps-style multi-scale zoom boundaries.
 * MIN_ZOOM = 0.012 shows the entire ~37 km MURS regional rail & highway network with settlement names.
 * MAX_ZOOM = 3.6 shows individual intersections, one-way arrows, house numbers, and every POI.
 */
export const MIN_MAP_ZOOM = 0.012;
export const MAX_MAP_ZOOM = 3.6;

export type MapZoomTier = 'regional' | 'metropolitan' | 'city' | 'quarter' | 'micro';

/** Smooth Hermite S-curve interpolation (0..1) for seamless layer fade-in / fade-out on zoom. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Smooth band-pass opacity: fades in over [in0..in1], stays 1, fades out over [out0..out1]. */
export function smoothBand(
  in0: number,
  in1: number,
  out0: number,
  out1: number,
  x: number
): number {
  return smoothstep(in0, in1, x) * (1 - smoothstep(out0, out1, x));
}

export interface MapZoomLodOpacity {
  settlements: number;
  villages: number;
  districts: number;
  buildings: number;
  /** Smooth 0..1 3D wall extrusion multiplier so buildings rise organically while zooming in */
  buildingExtrusion: number;
  houseNumbers: number;
  buildingIcons: number;
  buildingNames: number;
  streetLabels: number;
  minorStreetLabels: number;
  oneWayArrows: number;
  surfaceTransit: number;
  vehicles: number;
  metroRailStations: number;
  surfaceStations: number;
  surfaceStationLabels: number;
  majorPois: number;
  minorPois: number;
  poiLabels: number;
  landLabels: number;
  minorLandLabels: number;
  roadClassAlpha: (rc: RoadClass) => number;
}

export interface MapZoomLod {
  tier: MapZoomTier;
  /** Settlement (city/town/village) dot markers and names */
  showSettlements: boolean;
  /** Which settlement tiers are visible at this zoom */
  showVillages: boolean;
  /** Urban district / neighborhood watermark labels */
  showDistricts: boolean;
  /** Whether a road class should be rendered at this zoom */
  showRoadClass: (rc: RoadClass) => boolean;
  /** Render building footprints */
  showBuildings: boolean;
  /** Extrude 3D building walls (when in 3D mode) */
  extrudeBuildings: boolean;
  /** Show building house numbers */
  showHouseNumbers: boolean;
  /** Show building category badges on roofs */
  showBuildingIcons: boolean;
  /** Show street & highway labels along roads */
  showStreetLabels: boolean;
  /** Only label major roads (highway/avenue/embankment/railway) until closer */
  majorStreetLabelsOnly: boolean;
  /** Show one-way directional arrows along streets */
  showOneWayArrows: boolean;
  /** Transit line visibility level */
  transitLinesMode: 'major' | 'all';
  /** Station/stop visibility level */
  stationsMode: 'none' | 'metro-rail' | 'all-compact' | 'all-labeled';
  /** Show animated vehicles */
  showVehicles: boolean;
  /** Point-of-interest visibility level */
  poisMode: 'none' | 'major' | 'all';
  /** Show POI text labels next to icons */
  showPoiLabels: boolean;
  /** Show park/water labels */
  showLandLabels: boolean;
  /** Only label large water bodies / major parks at macro zoom */
  majorLandLabelsOnly: boolean;
  /** Continuous 0..1 opacity curves for smooth fade-in / fade-out during zoom animations */
  opacity: MapZoomLodOpacity;
}

/** High-significance POI icons visible at mid/city zoom (like museums, theatres, stations, hospitals). */
export const MAJOR_POI_ICONS: ReadonlySet<PoiIconKind> = new Set<PoiIconKind>([
  'station',
  'museum',
  'theater',
  'hospital',
  'university',
  'civic',
  'monument',
  'park',
  'sport',
  'hotel',
]);

export function clampMapZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0.34;
  return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, zoom));
}

export function computeMapZoomOpacity(zoom: number): MapZoomLodOpacity {
  const roadClassAlpha = (rc: RoadClass): number => {
    switch (rc) {
      case 'highway':
      case 'railway':
        return 1;
      case 'avenue':
        return smoothstep(0.026, 0.048, zoom);
      case 'embankment':
        return smoothstep(0.042, 0.068, zoom);
      case 'street':
        return smoothstep(0.072, 0.115, zoom);
      case 'lane':
        return smoothstep(0.115, 0.165, zoom);
      case 'pedestrian':
        return smoothstep(0.21, 0.29, zoom);
      case 'service':
      case 'dirt':
        return smoothstep(0.32, 0.44, zoom);
    }
  };

  return {
    settlements: 1 - smoothstep(0.145, 0.215, zoom),
    villages: smoothBand(0.015, 0.024, 0.125, 0.185, zoom),
    districts: smoothBand(0.052, 0.088, 0.48, 0.68, zoom),
    buildings: smoothstep(0.078, 0.128, zoom),
    buildingExtrusion: smoothstep(0.145, 0.245, zoom),
    houseNumbers: smoothstep(0.25, 0.35, zoom),
    buildingIcons: smoothstep(0.27, 0.37, zoom),
    buildingNames: smoothstep(0.76, 1.02, zoom),
    streetLabels: smoothstep(0.15, 0.23, zoom),
    minorStreetLabels: smoothstep(0.23, 0.32, zoom),
    oneWayArrows: smoothstep(0.24, 0.35, zoom),
    surfaceTransit: smoothstep(0.105, 0.165, zoom),
    vehicles: smoothstep(0.135, 0.205, zoom),
    metroRailStations: smoothstep(0.042, 0.072, zoom),
    surfaceStations: smoothstep(0.24, 0.34, zoom),
    surfaceStationLabels: smoothstep(0.40, 0.52, zoom),
    majorPois: smoothstep(0.14, 0.21, zoom),
    minorPois: smoothstep(0.32, 0.43, zoom),
    poiLabels: smoothstep(0.21, 0.31, zoom),
    landLabels: 1,
    minorLandLabels: smoothstep(0.11, 0.175, zoom),
    roadClassAlpha,
  };
}

/**
 * Computes semantic multi-scale map visibility (LOD) matching modern online maps:
 * - Regional (< 0.048): settlements, railways, highways, major water/forests
 * - Metropolitan (0.048..0.125): settlements, districts, arterial roads, metro/rail lines & stations
 * - City (0.125..0.36): districts, all main streets + labels, 3D buildings, surface transit, major POIs
 * - Quarter (0.36..0.85): service/dirt/pedestrian roads, house numbers, stop names, one-way arrows, all POIs
 * - Micro (>= 0.85): full close-up street detail, prominent one-way arrows, all POIs & labels
 */
export function getMapZoomLod(zoom: number): MapZoomLod {
  const opacity = computeMapZoomOpacity(zoom);

  if (zoom < 0.048) {
    return {
      tier: 'regional',
      showSettlements: true,
      showVillages: zoom >= 0.018,
      showDistricts: false,
      showRoadClass: (rc) =>
        rc === 'highway' || rc === 'railway' || (zoom >= 0.032 && rc === 'avenue'),
      showBuildings: false,
      extrudeBuildings: false,
      showHouseNumbers: false,
      showBuildingIcons: false,
      showStreetLabels: false,
      majorStreetLabelsOnly: true,
      showOneWayArrows: false,
      transitLinesMode: 'major',
      stationsMode: 'none',
      showVehicles: false,
      poisMode: 'none',
      showPoiLabels: false,
      showLandLabels: true,
      majorLandLabelsOnly: true,
      opacity,
    };
  }

  if (zoom < 0.125) {
    return {
      tier: 'metropolitan',
      showSettlements: true,
      showVillages: true,
      showDistricts: zoom >= 0.06,
      showRoadClass: (rc) =>
        rc === 'highway' ||
        rc === 'avenue' ||
        rc === 'embankment' ||
        rc === 'railway' ||
        (zoom >= 0.085 && rc === 'street'),
      showBuildings: zoom >= 0.088,
      extrudeBuildings: false,
      showHouseNumbers: false,
      showBuildingIcons: false,
      showStreetLabels: false,
      majorStreetLabelsOnly: true,
      showOneWayArrows: false,
      transitLinesMode: 'major',
      stationsMode: 'metro-rail',
      showVehicles: false,
      poisMode: 'none',
      showPoiLabels: false,
      showLandLabels: true,
      majorLandLabelsOnly: true,
      opacity,
    };
  }

  if (zoom < 0.36) {
    return {
      tier: 'city',
      showSettlements: zoom < 0.18,
      showVillages: zoom < 0.16,
      showDistricts: true,
      showRoadClass: (rc) =>
        rc !== 'service' && rc !== 'dirt' && (rc !== 'pedestrian' || zoom >= 0.24),
      showBuildings: true,
      extrudeBuildings: zoom >= 0.16,
      showHouseNumbers: zoom >= 0.28,
      showBuildingIcons: zoom >= 0.3,
      showStreetLabels: zoom >= 0.17,
      majorStreetLabelsOnly: zoom < 0.25,
      showOneWayArrows: zoom >= 0.28,
      transitLinesMode: 'all',
      stationsMode: 'all-compact',
      showVehicles: zoom >= 0.15,
      poisMode: zoom >= 0.16 ? 'major' : 'none',
      showPoiLabels: zoom >= 0.24,
      showLandLabels: true,
      majorLandLabelsOnly: false,
      opacity,
    };
  }

  if (zoom < 0.85) {
    return {
      tier: 'quarter',
      showSettlements: false,
      showVillages: false,
      showDistricts: zoom < 0.55,
      showRoadClass: () => true,
      showBuildings: true,
      extrudeBuildings: true,
      showHouseNumbers: true,
      showBuildingIcons: true,
      showStreetLabels: true,
      majorStreetLabelsOnly: false,
      showOneWayArrows: true,
      transitLinesMode: 'all',
      stationsMode: zoom >= 0.44 ? 'all-labeled' : 'all-compact',
      showVehicles: true,
      poisMode: 'all',
      showPoiLabels: true,
      showLandLabels: true,
      majorLandLabelsOnly: false,
      opacity,
    };
  }

  return {
    tier: 'micro',
    showSettlements: false,
    showVillages: false,
    showDistricts: false,
    showRoadClass: () => true,
    showBuildings: true,
    extrudeBuildings: true,
    showHouseNumbers: true,
    showBuildingIcons: true,
    showStreetLabels: true,
    majorStreetLabelsOnly: false,
    showOneWayArrows: true,
    transitLinesMode: 'all',
    stationsMode: 'all-labeled',
    showVehicles: true,
    poisMode: 'all',
    showPoiLabels: true,
    showLandLabels: true,
    majorLandLabelsOnly: false,
    opacity,
  };
}

/**
 * Curated MURS server settlements (cities, towns, villages) derived from real MTR rail/station geography.
 */
export const MURS_SETTLEMENTS: MapPlaceLabel[] = [
  { id: 'set-muromorsk', name: 'Муроморск', subtitle: 'Muromorsk', x: 10950, z: -1350, tier: 'city', priority: 100 },
  { id: 'set-krasnogradsk', name: 'Красноградск', subtitle: 'Krasnogradsk', x: 32864, z: -20114, tier: 'city', priority: 85 },
  { id: 'set-gornoozersk', name: 'Горноозерск', x: 33698, z: -17119, tier: 'town', priority: 75 },
  { id: 'set-ezhlesovo', name: 'Ежлесово', x: 28134, z: -15192, tier: 'town', priority: 72 },
  { id: 'set-grimau', name: 'Гримау', x: 31511, z: -19387, tier: 'town', priority: 68 },
  { id: 'set-zamurretskaya', name: 'Замуррецкая', x: -2231, z: -114, tier: 'town', priority: 70 },
  { id: 'set-finkovo', name: 'Финково', x: 29957, z: -17122, tier: 'village', priority: 55 },
  { id: 'set-butusovo', name: 'Бутусово', x: 25313, z: -14407, tier: 'village', priority: 55 },
  { id: 'set-lugovaya', name: 'Луговая', x: 22965, z: -14174, tier: 'village', priority: 54 },
  { id: 'set-lisiy', name: 'Лисий посёлок', x: 20261, z: -14080, tier: 'village', priority: 56 },
  { id: 'set-bortniki', name: 'Бортники', x: 18292, z: -13408, tier: 'village', priority: 54 },
  { id: 'set-kinastovskaya', name: 'Кинастовская', x: 16407, z: -11685, tier: 'village', priority: 54 },
  { id: 'set-tarasovka', name: 'Тарасовка', x: 15389, z: -10661, tier: 'village', priority: 55 },
  { id: 'set-luchiny', name: 'Лучины', x: 14701, z: -8867, tier: 'village', priority: 54 },
  { id: 'set-marinino', name: 'Маринино', x: 14717, z: -7010, tier: 'village', priority: 58 },
  { id: 'set-golovastiki', name: 'Головастики', x: -3547, z: -13, tier: 'village', priority: 52 },
];

/**
 * Curated districts & neighborhoods of Muromorsk visible at metropolitan & city zoom levels.
 */
export const MURS_DISTRICTS: MapPlaceLabel[] = [
  { id: 'dist-center', name: 'Центр', x: 10910, z: -1480, tier: 'district', priority: 90 },
  { id: 'dist-ivanko', name: 'Ивановский остров', x: 10280, z: -2920, tier: 'district', priority: 86 },
  { id: 'dist-novoiv', name: 'Новоивановский', x: 9230, z: -2985, tier: 'district', priority: 80 },
  { id: 'dist-primorsky', name: 'Приморский', x: 9420, z: -5220, tier: 'district', priority: 82 },
  { id: 'dist-porokhovka', name: 'Пороховка', x: 11360, z: -3975, tier: 'district', priority: 80 },
  { id: 'dist-vdnit', name: 'ВДНиТ', x: 9910, z: -4175, tier: 'district', priority: 78 },
  { id: 'dist-morskoy', name: 'Морской бульвар', x: 9880, z: -320, tier: 'district', priority: 82 },
  { id: 'dist-trefolev', name: 'Трефолевский Посад', x: 11330, z: -585, tier: 'district', priority: 78 },
  { id: 'dist-vokzal', name: 'Вокзальная', x: 12410, z: 480, tier: 'district', priority: 85 },
  { id: 'dist-pavlovsky', name: 'Павловский', x: 10100, z: 540, tier: 'district', priority: 78 },
  { id: 'dist-tovarnaya', name: 'Товарная', x: 11560, z: 1850, tier: 'district', priority: 75 },
  { id: 'dist-dvorets', name: 'Дворец Спорта', x: 13810, z: 1860, tier: 'district', priority: 82 },
  { id: 'dist-brestskaya', name: 'Брестская', x: 15048, z: 3397, tier: 'district', priority: 78 },
  { id: 'dist-serp', name: 'Серп и Молот', x: 13794, z: 563, tier: 'district', priority: 76 },
  { id: 'dist-murvagon', name: 'МурВагонМаш', x: 9087, z: 1743, tier: 'district', priority: 74 },
  { id: 'dist-nevsky', name: 'Невский вокзал', x: 12360, z: -3348, tier: 'district', priority: 76 },
];

/**
 * Merges curated MURS settlements with any live outlying MTR rail/station clusters
 * not already covered within 1500 blocks, ensuring regional zoom always reflects live server geography.
 */
export function buildRegionalSettlements(stations: MtrStation[]): MapPlaceLabel[] {
  const result: MapPlaceLabel[] = [...MURS_SETTLEMENTS];
  if (!stations || stations.length === 0) return result;

  // Group outlying rail/metro stations in 1800-block cells to discover any new settlements automatically
  const cells = new Map<string, MtrStation[]>();
  for (const st of stations) {
    // Skip stations already near a known settlement
    const nearKnown = result.some((p) => Math.hypot(p.x - st.x, p.z - st.z) < 1600);
    if (nearKnown) continue;
    // Skip inside Muromorsk core (covered by MURS_SETTLEMENTS + MURS_DISTRICTS)
    if (st.x >= 7200 && st.x <= 15600 && st.z >= -6200 && st.z <= 4200) continue;
    if (/оборот|депо|test|разворот|по требованию/i.test(st.name)) continue;

    const k = `${Math.floor(st.x / 1800)},${Math.floor(st.z / 1800)}`;
    const arr = cells.get(k);
    if (arr) arr.push(st);
    else cells.set(k, [st]);
  }

  for (const [key, list] of cells.entries()) {
    const cx = Math.round(list.reduce((s, p) => s + p.x, 0) / list.length);
    const cz = Math.round(list.reduce((s, p) => s + p.z, 0) / list.length);
    const best = list.sort((a, b) => b.routeIds.length - a.routeIds.length)[0];
    const cleanName = best.name
      .replace(/^(Ж\/Д\s*ст\.|Ст\.\s*м\.|Метро|Платформа)\s*/i, '')
      .replace(/[«»"]/g, '')
      .trim();
    if (!cleanName || cleanName.length < 2) continue;

    result.push({
      id: `dyn-set-${key}`,
      name: cleanName,
      x: cx,
      z: cz,
      tier: list.length >= 4 ? 'town' : 'village',
      priority: list.length >= 4 ? 65 : 48,
    });
  }

  result.sort((a, b) => b.priority - a.priority);
  return result;
}

/**
 * Produces the merged, user-editable list of all map place labels (cities, towns, villages, districts)
 * by combining curated/live defaults with user edits and deletions.
 */
export function mergeMapPlaces(
  stations: MtrStation[],
  userPlaces?: MapPlaceLabel[],
  deletedPlaceIds?: string[]
): MapPlaceLabel[] {
  const deletedSet = new Set(deletedPlaceIds ?? []);
  const map = new Map<string, MapPlaceLabel>();

  for (const p of buildRegionalSettlements(stations)) {
    if (!deletedSet.has(p.id)) map.set(p.id, p);
  }
  for (const d of MURS_DISTRICTS) {
    if (!deletedSet.has(d.id)) map.set(d.id, d);
  }
  for (const up of userPlaces ?? []) {
    if (!deletedSet.has(up.id)) {
      map.set(up.id, { ...up, isUserEdited: true });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.priority - a.priority);
}

/**
 * Deterministic cartographic scale priority for settlements and districts:
 * City (5000+) > Town (4500+) > Village (4000+) > District (3500+) > Metro Station (3000+) > Rail Station (2000+)
 */
export function getPlaceHierarchyPriority(place: MapPlaceLabel): number {
  const base =
    place.tier === 'city'
      ? 5000
      : place.tier === 'town'
      ? 4500
      : place.tier === 'village'
      ? 4000
      : 3500;
  return base + (place.priority ?? 50);
}

/**
 * Deterministic cartographic scale priority for transit stations/stops:
 * Metro (3000+) > Rail (2000+) > Cable/Boat/Plane (1400+) > Tram/Trolleybus (1000+) > Bus (800+).
 * Ensures larger-scale transit hubs always reserve screen space before smaller stops and never get covered.
 */
export function getStationHierarchyPriority(station: MtrStation): number {
  const routeBonus = Math.min(200, station.routeIds.length * 16);
  if (station.kinds.includes('metro')) {
    return 3000 + routeBonus + (station.kinds.includes('rail') ? 100 : 0);
  }
  if (station.kinds.includes('rail')) {
    return 2000 + routeBonus;
  }
  if (
    station.kinds.includes('cable') ||
    station.kinds.includes('boat') ||
    station.kinds.includes('plane')
  ) {
    return 1400 + routeBonus;
  }
  if (station.kinds.includes('tram') || station.kinds.includes('trolleybus')) {
    return 1000 + routeBonus;
  }
  return 800 + routeBonus;
}

/**
 * Normalizes a station name for on-screen platform deduplication so multi-track / twin-platform
 * nodes with identical names don't stack overlapping icons or labels on top of each other.
 */
export function normalizeStationNameForDedup(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[«»"']/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Universal per-element time-based entrance animator for map elements & labels.
 * Smoothly animates opacity (0..1) and scale/extrusion whenever elements appear
 * (when zooming out from close/minimum camera distance, zooming away from MIN_MAP_ZOOM,
 * de-clustering labels, or loading map objects), and settles to 0% idle CPU after `durationMs`.
 */
export class ElementAppearanceAnimator {
  private readonly entries = new Map<
    string,
    { startTs: number; lastSeenFrame: number; lastSeenTs: number }
  >();
  private readonly durationMs: number;
  private frameSeq = 0;
  private seedReady = false;
  public hasActiveAnimations = false;

  constructor(durationMs = 380, _legacyAbsenceResetMs = 140) {
    void _legacyAbsenceResetMs;
    this.durationMs = Math.max(60, durationMs);
  }

  beginFrame(): void {
    this.frameSeq += 1;
    this.hasActiveAnimations = false;
  }

  endFrame(nowMs: number): void {
    this.seedReady = true;
    // Periodically prune stale entries that haven't been rendered in recent frames
    if (this.entries.size > 6000) {
      const frameCutoff = this.frameSeq - 120;
      const timeCutoff = nowMs - 10_000;
      for (const [k, v] of this.entries.entries()) {
        if (v.lastSeenFrame < frameCutoff && v.lastSeenTs < timeCutoff) {
          this.entries.delete(k);
        }
      }
    }
  }

  /**
   * Triggers a fresh entrance wave for elements when moving away from minimum zoom
   * (or zooming out from close-up / loading a save).
   */
  triggerEntranceWave(nowMs: number, preservePrefix?: string): void {
    this.seedReady = true;
    for (const [key, entry] of this.entries.entries()) {
      if (preservePrefix && key.startsWith(preservePrefix)) continue;
      entry.startTs = nowMs;
      entry.lastSeenFrame = this.frameSeq;
      entry.lastSeenTs = nowMs;
    }
    this.hasActiveAnimations = true;
  }

  /**
   * Returns smooth cubic ease-out appearance progress in `(0..1]` for element `key`.
   * Uses frame-sequence continuity (`frameSeq - lastSeenFrame > 1`) to detect true visibility
   * transitions, so slow frames or 1-second idle redraws NEVER falsely restart animations!
   */
  getProgress(key: string, nowMs: number, forceImmediate = false): number {
    if (forceImmediate) {
      this.entries.set(key, {
        startTs: nowMs - this.durationMs,
        lastSeenFrame: this.frameSeq,
        lastSeenTs: nowMs,
      });
      return 1;
    }

    let entry = this.entries.get(key);
    if (!entry) {
      const startTs = this.seedReady ? nowMs : nowMs - this.durationMs;
      entry = { startTs, lastSeenFrame: this.frameSeq, lastSeenTs: nowMs };
      this.entries.set(key, entry);
    } else {
      if (this.seedReady && this.frameSeq - entry.lastSeenFrame > 1) {
        entry.startTs = nowMs;
      }
      entry.lastSeenFrame = this.frameSeq;
      entry.lastSeenTs = nowMs;
    }

    const elapsed = Math.max(0, nowMs - entry.startTs);
    if (elapsed >= this.durationMs) {
      return 1;
    }

    this.hasActiveAnimations = true;
    const t = elapsed / this.durationMs;
    // Smooth cubic ease-out from 0.04 -> 1.0 for organic pop-in / fade-in
    const ease = 1 - Math.pow(1 - t, 3);
    return 0.04 + 0.96 * ease;
  }
}

export interface CachedTerritoryLabel {
  key: string;
  name: string;
  kind: 'water' | 'park' | 'square';
  worldX: number;
  worldZ: number;
  angle: number;
  baseAlpha: number;
  isRegional: boolean;
}

export interface TerritoryLabelCameraSnapshot {
  x: number;
  z: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export type TerritoryLabelPhase = 'visible' | 'fading-out' | 'hidden' | 'fading-in';

export interface TerritoryLabelFrameState {
  phase: TerritoryLabelPhase;
  opacity: number;
  scale: number;
  shouldRecompute: boolean;
  needsAnimationFrame: boolean;
  wakeAfterMs: number | null;
}

/**
 * Controls territory label visibility across camera motion:
 * - As soon as the camera begins panning, zooming, tilting, or rotating, cached labels
 *   remain pinned to their world coordinates and smoothly dissolve out (`fadeOutMs`).
 * - While the camera is moving, territory labels stay hidden (never sliding or jittering).
 * - Once the camera stays completely still for `settleDelayMs`, labels recompute fresh
 *   interior rotated anchors ONCE and smoothly fade back in (`fadeInMs`), then drop to 0% idle CPU.
 */
export class TerritoryLabelFadeController {
  private readonly fadeOutMs: number;
  private readonly settleDelayMs: number;
  private readonly fadeInMs: number;

  private phase: TerritoryLabelPhase = 'visible';
  private opacity = 1;
  private phaseStartTs = 0;
  private startOpacity = 1;
  private lastMoveTs = -Infinity;
  private prevCam: TerritoryLabelCameraSnapshot | null = null;
  private cachedLabels: CachedTerritoryLabel[] = [];
  private needsFreshPlacement = true;
  public needsAnimationFrame = false;

  constructor(fadeOutMs = 150, settleDelayMs = 220, fadeInMs = 340) {
    this.fadeOutMs = Math.max(40, fadeOutMs);
    this.settleDelayMs = Math.max(40, settleDelayMs);
    this.fadeInMs = Math.max(80, fadeInMs);
  }

  invalidatePlacement(): void {
    this.needsFreshPlacement = true;
  }

  getCachedLabels(): readonly CachedTerritoryLabel[] {
    return this.cachedLabels;
  }

  setCachedLabels(labels: CachedTerritoryLabel[]): void {
    this.cachedLabels = labels;
  }

  update(
    cam: TerritoryLabelCameraSnapshot,
    isMovingHint: boolean,
    nowMs: number
  ): TerritoryLabelFrameState {
    const moved =
      this.prevCam !== null &&
      (Math.hypot(cam.x - this.prevCam.x, cam.z - this.prevCam.z) > 0.04 ||
        Math.abs(cam.zoom - this.prevCam.zoom) / Math.max(1e-4, this.prevCam.zoom) > 0.0004 ||
        Math.abs(cam.pitch - this.prevCam.pitch) > 0.04 ||
        Math.abs(((cam.bearing - this.prevCam.bearing + 540) % 360) - 180) > 0.04);

    this.prevCam = {
      x: cam.x,
      z: cam.z,
      zoom: cam.zoom,
      pitch: cam.pitch,
      bearing: cam.bearing,
    };

    const activelyMoving = moved || isMovingHint;

    if (activelyMoving) {
      this.lastMoveTs = nowMs;
      this.needsFreshPlacement = true;

      if (this.phase === 'visible' || this.phase === 'fading-in') {
        if (this.cachedLabels.length === 0 || this.opacity <= 0.01) {
          this.phase = 'hidden';
          this.opacity = 0;
        } else {
          this.phase = 'fading-out';
          this.phaseStartTs = nowMs;
          this.startOpacity = this.opacity;
        }
      }

      if (this.phase === 'fading-out') {
        const t = Math.min(1, Math.max(0, (nowMs - this.phaseStartTs) / this.fadeOutMs));
        this.opacity = this.startOpacity * (1 - t) * (1 - t);
        if (t >= 1 || this.opacity <= 0.005) {
          this.opacity = 0;
          this.phase = 'hidden';
        }
      }

      this.needsAnimationFrame = this.phase === 'fading-out';
      return {
        phase: this.phase,
        opacity: this.opacity,
        scale: 1,
        shouldRecompute: false,
        needsAnimationFrame: this.needsAnimationFrame,
        wakeAfterMs: this.phase === 'hidden' ? this.settleDelayMs + 8 : null,
      };
    }

    // Camera is stationary this frame
    if (this.phase === 'fading-out') {
      const t = Math.min(1, Math.max(0, (nowMs - this.phaseStartTs) / this.fadeOutMs));
      this.opacity = this.startOpacity * (1 - t) * (1 - t);
      if (t >= 1 || this.opacity <= 0.005) {
        this.opacity = 0;
        this.phase = 'hidden';
      } else {
        this.needsAnimationFrame = true;
        return {
          phase: 'fading-out',
          opacity: this.opacity,
          scale: 1,
          shouldRecompute: false,
          needsAnimationFrame: true,
          wakeAfterMs: null,
        };
      }
    }

    if (this.phase === 'hidden') {
      const idleFor = nowMs - this.lastMoveTs;
      if (idleFor < this.settleDelayMs) {
        this.needsAnimationFrame = false;
        return {
          phase: 'hidden',
          opacity: 0,
          scale: 0.96,
          shouldRecompute: false,
          needsAnimationFrame: false,
          wakeAfterMs: Math.max(16, Math.ceil(this.settleDelayMs - idleFor) + 8),
        };
      }
      // Camera has rested long enough — recompute fresh placements once & fade in smoothly
      this.phase = 'fading-in';
      this.phaseStartTs = nowMs;
      this.startOpacity = 0;
      this.opacity = 0;
      this.needsFreshPlacement = true;
    }

    if (this.phase === 'fading-in') {
      const shouldRecompute = this.needsFreshPlacement;
      this.needsFreshPlacement = false;
      const t = Math.min(1, Math.max(0, (nowMs - this.phaseStartTs) / this.fadeInMs));
      const ease = 1 - Math.pow(1 - t, 3);
      this.opacity = Math.max(0.02, ease);
      const scale = 0.95 + 0.05 * ease;
      if (t >= 1) {
        this.opacity = 1;
        this.phase = 'visible';
        this.needsAnimationFrame = false;
        return {
          phase: 'visible',
          opacity: 1,
          scale: 1,
          shouldRecompute,
          needsAnimationFrame: false,
          wakeAfterMs: null,
        };
      }
      this.needsAnimationFrame = true;
      return {
        phase: 'fading-in',
        opacity: this.opacity,
        scale,
        shouldRecompute,
        needsAnimationFrame: true,
        wakeAfterMs: null,
      };
    }

    // phase === 'visible'
    const shouldRecompute = this.needsFreshPlacement;
    this.needsFreshPlacement = false;
    this.opacity = 1;
    this.needsAnimationFrame = false;
    return {
      phase: 'visible',
      opacity: 1,
      scale: 1,
      shouldRecompute,
      needsAnimationFrame: false,
      wakeAfterMs: null,
    };
  }
}



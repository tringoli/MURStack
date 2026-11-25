import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Navigation,
  Pencil,
  Search,
  TrainFront,
  Upload,
  X,
} from 'lucide-react';
import { MapCanvas3D } from './components/MapCanvas3D';
import { MapControls } from './components/MapControls';
import { InsolationControl } from './components/InsolationControl';
import { RoutePanel } from './components/RoutePanel';
import { PlaceCard } from './components/PlaceCard';
import { EditorPanel } from './components/EditorPanel';
import { SynthesisPanel } from './components/SynthesisPanel';
import {
  buildFallbackMtrData,
  DEFAULT_BUILDINGS,
  DEFAULT_LAND_FEATURES,
  DEFAULT_STREETS,
  MURS_DEFAULT_CENTER,
} from './data/mursDefaultData';
import type {
  BlueMapTileImage,
  Building3D,
  BuildingCategory,
  CameraState,
  DepartureInfo,
  EditorTool,
  LandFeature,
  MagicApiStatus,
  MapEditsPayload,
  MapLayerVisibility,
  MapPlaceLabel,
  MapPoi,
  MapStyleMode,
  MtrRoute,
  MtrStation,
  MultiSelectedItem,
  MultiSelectKind,
  OneWayDirection,
  PoiIconKind,
  RoadClass,
  RoofType,
  RouteEndpoint,
  SelectedEntity,
  SettlementTier,
  SidebarTab,
  SimVehicleType,
  SolarInsolationState,
  StreetSegment,
  SynthesisStats,
  TravelMode,
  WorldPoint,
  WorldPoint3D,
} from './types/map';
import {
  extractServerClockOffsetMs,
  parseDeparturesPayload,
  parseMtrStationsAndRoutes,
  type RawDeparturesPayload,
  type RawMtrPayload,
} from './utils/mtrParser';
import {
  computeStreetRoute,
  computeTransitRoutes,
  getTransportLabelRu,
} from './utils/routing';
import {
  formatLocalTimeRu,
  parseLocalTimeInputToEpochMs,
} from './utils/scheduleSync';
import { getCurrentKaliningradDateTime } from './utils/solarInsolation';
import {
  computePolygonBounds,
  decodeBlueMapTileRgba,
  runUrbanSynthesisPipeline,
  tracePublicTransitOverStreets,
  type HeightColorGrid,
  type SynthesisOptions,
} from './utils/urbanSynthesizer';
import {
  autoAddressBuildingsForStreet,
  autoAddressNewBuilding,
} from './utils/houseNumbering';
import {
  parseMagicRailsPayload,
  traceRoutesFromMagicRails,
  type MagicRailSegment,
} from './utils/magicTracks';
import {
  integrateStreetWithAutoIntersections,
  SERVER_GROUND_Y,
  snapBuildingRectToStreet,
  type RoadSnappedBuildingRect,
} from './utils/geometry';
import {
  createCircleFootprint,
  createParallelogramFootprint,
  createRectFootprint,
  createTriangleFootprint,
} from './utils/projection';
import { MAX_MAP_ZOOM, mergeMapPlaces, MIN_MAP_ZOOM } from './utils/mapZoomLod';
import { inferDistrict } from './utils/mtrParser';
import {
  buildTerrainReliefCanvas,
  decodeTerrainElevationTile,
} from './utils/terrainRelief';
import {
  addWingToBuilding,
  computePolygonCentroidAndDims,
  convertWingToFreeform,
  ensureClockwiseFootprint,
  getBuildingWings,
  mergeBuildings,
  mergeMultipleBuildings,
  removeWingFromBuilding,
  rotateBuilding,
  splitBuilding,
} from './utils/buildingOps';
import {
  mergeAndSmoothRoadNetwork,
  synthesizeRoadsAndRailsFromMagic,
} from './utils/roadMerger';
import { computeViewportWorldBounds } from './utils/spatialIndex';
import { TransitStopBadge } from './components/TransitStopBadge';
import { MuromorskMetroBadge } from './components/MuromorskMetroBadge';
import { isMuromorskMetroRoute } from './utils/mursTransitBrand';
import { buildStationCombinedModesMap } from './utils/transitStopIcons';
import { POI_ICON_MAP, resolveBuildingIconKind } from './utils/poiIcons';
import { searchMapEntities } from './utils/smartSearch';

const LOCAL_STORAGE_KEY = 'murs_maps_edits_v1';
const SYNTH_CACHE_KEY = 'murs_maps_synth_draft_v1';
const AUTO_SAVE_SYNTH_KEY = 'murs_maps_autosave_synth_v1';

const EMPTY_EDITS: MapEditsPayload = {
  buildings: [],
  deletedBuildingIds: [],
  streets: [],
  deletedStreetIds: [],
  landFeatures: [],
  deletedLandIds: [],
  pois: [],
  deletedPoiIds: [],
  places: [],
  deletedPlaceIds: [],
  stationOverrides: {},
  routeOverrides: {},
  updatedAt: '',
};

function loadLocalEdits(): MapEditsPayload {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return EMPTY_EDITS;
    const parsed = JSON.parse(raw);
    return {
      buildings: Array.isArray(parsed.buildings) ? parsed.buildings : [],
      deletedBuildingIds: Array.isArray(parsed.deletedBuildingIds) ? parsed.deletedBuildingIds : [],
      streets: Array.isArray(parsed.streets) ? parsed.streets : [],
      deletedStreetIds: Array.isArray(parsed.deletedStreetIds) ? parsed.deletedStreetIds : [],
      landFeatures: Array.isArray(parsed.landFeatures) ? parsed.landFeatures : [],
      deletedLandIds: Array.isArray(parsed.deletedLandIds) ? parsed.deletedLandIds : [],
      pois: Array.isArray(parsed.pois) ? parsed.pois : [],
      deletedPoiIds: Array.isArray(parsed.deletedPoiIds) ? parsed.deletedPoiIds : [],
      places: Array.isArray(parsed.places) ? parsed.places : [],
      deletedPlaceIds: Array.isArray(parsed.deletedPlaceIds) ? parsed.deletedPlaceIds : [],
      stationOverrides:
        parsed.stationOverrides && typeof parsed.stationOverrides === 'object'
          ? parsed.stationOverrides
          : {},
      routeOverrides:
        parsed.routeOverrides && typeof parsed.routeOverrides === 'object'
          ? parsed.routeOverrides
          : {},
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return EMPTY_EDITS;
  }
}

function polylineIntersectsRect(
  pts: WorldPoint[],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): boolean {
  for (const p of pts) {
    if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ) return true;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    for (let k = 1; k <= 6; k++) {
      const f = k / 7;
      const sx = a.x + (b.x - a.x) * f;
      const sz = a.z + (b.z - a.z) * f;
      if (sx >= minX && sx <= maxX && sz >= minZ && sz <= maxZ) return true;
    }
  }
  return false;
}

/**
 * BlueMap 5.3 lowres tiles are 501x1002 PNGs where the top 500x500 pixels represent
 * exact [tx*tileSpan .. (tx+1)*tileSpan) world blocks, and pixel index 500 is a 1px
 * overlap gutter. Cropping exact 500x500 guarantees pixel-perfect coordinate stitching!
 */
function createFastRgbTileCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const rawW = img.naturalWidth || 500;
  const rawHalfH = Math.floor((img.naturalHeight || 1000) / 2);
  const srcW = rawW === 501 ? 500 : Math.min(500, rawW);
  const srcH = rawHalfH === 501 ? 500 : Math.min(500, rawHalfH);
  c.width = Math.max(1, srcW);
  c.height = Math.max(1, srcH);
  const ctx = c.getContext('2d');
  if (ctx && srcW > 0 && srcH > 0) {
    ctx.drawImage(img, 0, 0, srcW, srcH, 0, 0, c.width, c.height);
  }
  return c;
}

function decodeTerrainFromImage(
  img: HTMLImageElement,
  tx: number,
  tz: number,
  lod: 1 | 2 | 3,
  rgba?: Uint8ClampedArray,
  imgW?: number,
  imgH?: number
) {
  let pixelData = rgba;
  const w = imgW ?? img.naturalWidth;
  const h = imgH ?? img.naturalHeight;
  if (!pixelData && w > 10 && h > 20) {
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const octx = offscreen.getContext('2d', { willReadFrequently: true });
    if (octx) {
      octx.drawImage(img, 0, 0);
      pixelData = octx.getImageData(0, 0, w, h).data;
    }
  }
  let terrain = pixelData
    ? decodeTerrainElevationTile(pixelData, w, h, tx, tz, lod, 84) ?? undefined
    : undefined;
  if (terrain) {
    terrain = {
      ...terrain,
      lightCanvas: buildTerrainReliefCanvas(terrain, false),
      darkCanvas: buildTerrainReliefCanvas(terrain, true),
    };
  }
  return terrain;
}

function buildTileImage(
  img: HTMLImageElement,
  tx: number,
  tz: number,
  lod: 1 | 2 | 3,
  tileSpan: number,
  decodeRelief: boolean,
  rgba?: Uint8ClampedArray,
  imgW?: number,
  imgH?: number
): BlueMapTileImage {
  const terrain = decodeRelief
    ? decodeTerrainFromImage(img, tx, tz, lod, rgba, imgW, imgH)
    : undefined;

  return {
    tx,
    tz,
    lod,
    worldX: tx * tileSpan,
    worldZ: tz * tileSpan,
    sizeBlocks: tileSpan,
    image: createFastRgbTileCanvas(img),
    terrain,
  };
}

function evictFarthestTiles(
  tiles: BlueMapTileImage[],
  camX: number,
  camZ: number,
  maxTiles = 110
): BlueMapTileImage[] {
  if (tiles.length <= maxTiles) return tiles;
  return [...tiles]
    .sort((a, b) => {
      const da = Math.hypot(a.worldX + a.sizeBlocks * 0.5 - camX, a.worldZ + a.sizeBlocks * 0.5 - camZ);
      const db = Math.hypot(b.worldX + b.sizeBlocks * 0.5 - camX, b.worldZ + b.sizeBlocks * 0.5 - camZ);
      return da - db;
    })
    .slice(0, maxTiles);
}

function loadSynthDraft(): { buildings: Building3D[]; streets: StreetSegment[] } {
  try {
    const raw = localStorage.getItem(SYNTH_CACHE_KEY);
    if (!raw) return { buildings: [], streets: [] };
    const parsed = JSON.parse(raw);
    return {
      buildings: Array.isArray(parsed.buildings) ? parsed.buildings : [],
      streets: Array.isArray(parsed.streets) ? parsed.streets : [],
    };
  } catch {
    return { buildings: [], streets: [] };
  }
}

export default function App() {
  const initialFallback = useMemo(() => buildFallbackMtrData(), []);
  const initialSynthDraft = useMemo(() => loadSynthDraft(), []);

  // Raw live transit network data (kept immutable so user moves preserve 100% of original metadata)
  const [rawStations, setRawStations] = useState<MtrStation[]>(initialFallback.stations);
  const [rawRoutes, setRawRoutes] = useState<MtrRoute[]>(initialFallback.routes);
  const [departuresMap, setDeparturesMap] = useState<Map<string, DepartureInfo>>(() => new Map());
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState<number>(0);
  const [mtrSource, setMtrSource] = useState<'fallback' | 'live'>('fallback');

  // Track geometry & status
  const [magicRails, setMagicRails] = useState<MagicRailSegment[]>([]);
  const [magicVehiclesCount, setMagicVehiclesCount] = useState(0);
  const [magicMode, setMagicMode] = useState<MagicApiStatus['mode']>('magic-jme-3d');
  const [magicEndpoint, setMagicEndpoint] = useState('http://map.murs-mc.ru:8088/api/rails?dimension=0');
  const [magicDiagnostic, setMagicDiagnostic] = useState<string | undefined>(undefined);
  const [magicRefreshing, setMagicRefreshing] = useState(false);

  // Auto-synthesized urban layer (persisted in draft cache + explicitly saveable onto permanent map)
  const [autoBuildings, setAutoBuildings] = useState<Building3D[]>(initialSynthDraft.buildings);
  const [autoStreets, setAutoStreets] = useState<StreetSegment[]>(initialSynthDraft.streets);
  const [autoSaveSynthesis, setAutoSaveSynthesis] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_SAVE_SYNTH_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [saveSynthNotice, setSaveSynthNotice] = useState<string | null>(null);
  const [blueMapTiles, setBlueMapTiles] = useState<BlueMapTileImage[]>([]);
  const [synthesisStats, setSynthesisStats] = useState<SynthesisStats | null>(null);
  const [synthesisRunning, setSynthesisRunning] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [synthesisPolygon, setSynthesisPolygon] = useState<WorldPoint[]>([]);
  const [isSynthesisPolygonClosed, setIsSynthesisPolygonClosed] = useState(false);
  const [isSelectingSynthesisArea, setIsSelectingSynthesisArea] = useState(false);
  const [synthesisOptions, setSynthesisOptions] = useState<Required<SynthesisOptions>>({
    targetMode: 'both',
    tileLod: 1,
    areaSideBlocks: 500,
    blockStrictness: 0,
    allowedBlockGroups: ['stone_brick', 'concrete_asphalt', 'wood_roof', 'glass_metal'],
    allowedRoadClasses: ['highway', 'avenue', 'street', 'lane', 'service', 'dirt', 'pedestrian'],
    minBuildingHeight: 3,
    minBuildingAreaBlocks: 4,
    maxBuildingAreaBlocks: 1_000_000,
    minStreetWidthBlocks: 6,
    maxStreetWidthBlocks: 48,
    minShapeSolidity: 0.25,
    shapeSimplification: 0.55,
    allowedRoofTypes: ['flat', 'pitched', 'curved', 'complex'],
    buildingShapeFilter: 'all',
    maxBuildingsPerRun: 0,
    snapSurfaceTransit: true,
    cropPolygon: [],
  });
  const saveDebounceRef = useRef<number | null>(null);

  // Map edits (buildings, streets, parks/water, moved stations & transit lines) + Undo/Redo history
  const [edits, setEdits] = useState<MapEditsPayload>(() => loadLocalEdits());
  const [undoStack, setUndoStack] = useState<MapEditsPayload[]>([]);
  const [redoStack, setRedoStack] = useState<MapEditsPayload[]>([]);
  const editsRef = useRef(edits);
  editsRef.current = edits;

  // Keep unsaved working synthesis cached in localStorage so it never vanishes across steps/reloads
  useEffect(() => {
    try {
      localStorage.setItem(
        SYNTH_CACHE_KEY,
        JSON.stringify({
          buildings: autoBuildings,
          streets: autoStreets,
        })
      );
    } catch {
      // ignore quota errors
    }
  }, [autoBuildings, autoStreets]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_SAVE_SYNTH_KEY, autoSaveSynthesis ? '1' : '0');
    } catch {
      // ignore
    }
  }, [autoSaveSynthesis]);

  // Merged buildings, streets, and land features (initial map starts clean with ONLY transit lines!)
  const buildings = useMemo<Building3D[]>(() => {
    const deletedSet = new Set(edits.deletedBuildingIds);
    const map = new Map<string, Building3D>();
    for (const b of DEFAULT_BUILDINGS) {
      if (!deletedSet.has(b.id)) map.set(b.id, b);
    }
    for (const b of edits.buildings) {
      if (!deletedSet.has(b.id)) map.set(b.id, { ...b, isUserEdited: true });
    }
    for (const b of autoBuildings) {
      if (!deletedSet.has(b.id) && !map.has(b.id)) map.set(b.id, b);
    }
    return Array.from(map.values());
  }, [edits.buildings, edits.deletedBuildingIds, autoBuildings]);

  const streets = useMemo<StreetSegment[]>(() => {
    const deletedSet = new Set(edits.deletedStreetIds);
    const map = new Map<string, StreetSegment>();
    for (const s of autoStreets) {
      if (!deletedSet.has(s.id)) map.set(s.id, s);
    }
    for (const s of DEFAULT_STREETS) {
      if (!deletedSet.has(s.id)) map.set(s.id, s);
    }
    for (const s of edits.streets) {
      if (!deletedSet.has(s.id)) map.set(s.id, { ...s, isUserEdited: true });
    }
    return Array.from(map.values());
  }, [edits.streets, edits.deletedStreetIds, autoStreets]);

  const landFeatures = useMemo<LandFeature[]>(() => {
    const deletedSet = new Set(edits.deletedLandIds ?? []);
    const map = new Map<string, LandFeature>();
    for (const f of DEFAULT_LAND_FEATURES) {
      if (!deletedSet.has(f.id)) map.set(f.id, f);
    }
    for (const f of edits.landFeatures ?? []) {
      if (!deletedSet.has(f.id)) map.set(f.id, { ...f, isUserEdited: true });
    }
    return Array.from(map.values());
  }, [edits.landFeatures, edits.deletedLandIds]);

  const pois = useMemo<MapPoi[]>(() => {
    const deletedSet = new Set(edits.deletedPoiIds ?? []);
    const map = new Map<string, MapPoi>();
    for (const p of edits.pois ?? []) {
      if (!deletedSet.has(p.id)) map.set(p.id, { ...p, isUserEdited: true });
    }
    return Array.from(map.values());
  }, [edits.pois, edits.deletedPoiIds]);

  // Apply user station overrides while preserving 100% of underlying route & stop metadata
  const stations = useMemo<MtrStation[]>(() => {
    const overrides = edits.stationOverrides ?? {};
    return rawStations.map((s) => {
      const ov = overrides[s.id];
      if (!ov) return s;
      return {
        ...s,
        x: ov.x,
        z: ov.z,
        y: ov.y ?? s.y,
        name: ov.name ?? s.name,
      };
    });
  }, [rawStations, edits.stationOverrides]);

  // Editable cities, towns, villages & urban districts (merged with user text/position edits)
  const mapPlaces = useMemo<MapPlaceLabel[]>(
    () => mergeMapPlaces(stations, edits.places, edits.deletedPlaceIds),
    [stations, edits.places, edits.deletedPlaceIds]
  );

  // Sync moved station coordinates into every route's stop list before tracing
  const rawRoutesWithStationMoves = useMemo<MtrRoute[]>(() => {
    const overrides = edits.stationOverrides ?? {};
    if (Object.keys(overrides).length === 0) return rawRoutes;
    return rawRoutes.map((r) => {
      let changed = false;
      const nextStops = r.stops.map((st) => {
        const ov = overrides[st.stationId];
        if (!ov) return st;
        changed = true;
        return {
          ...st,
          x: ov.x,
          z: ov.z,
          y: ov.y ?? st.y,
          name: ov.name ?? st.name,
        };
      });
      return changed ? { ...r, stops: nextStops } : r;
    });
  }, [rawRoutes, edits.stationOverrides]);

  // Stage 3: Trace public transport lines + apply user-edited transit line path overrides
  const tracedTransitResult = useMemo(() => {
    let baseResult: {
      tracedRoutes: MtrRoute[];
      routesSnapped: number;
      totalSurfaceRoutes: number;
      avgStreetCoveragePct: number;
      magicRoutesTraced: number;
    };

    if (magicRails.length > 0) {
      const mRes = traceRoutesFromMagicRails(
        rawRoutesWithStationMoves,
        magicRails,
        magicVehiclesCount
      );
      let finalRoutes = mRes.routes;
      // Hybrid fill: if some surface routes weren't tagged in MAGIC rails, still snap them to mapped streets
      if (synthesisOptions.snapSurfaceTransit && streets.length > 0) {
        const untraced = finalRoutes.filter((r) => !r.magicTraced);
        if (untraced.length > 0) {
          const sRes = tracePublicTransitOverStreets(untraced, streets);
          const snappedById = new Map(sRes.tracedRoutes.map((r) => [r.id, r]));
          finalRoutes = finalRoutes.map((r) => (!r.magicTraced ? snappedById.get(r.id) ?? r : r));
        }
      }
      baseResult = {
        tracedRoutes: finalRoutes,
        routesSnapped: mRes.routesTracedFromMagicRails,
        totalSurfaceRoutes: rawRoutesWithStationMoves.filter(
          (r) => r.kind !== 'metro' && r.kind !== 'rail'
        ).length,
        avgStreetCoveragePct:
          mRes.totalRoutes > 0
            ? Math.round((mRes.routesTracedFromMagicRails / mRes.totalRoutes) * 100)
            : 0,
        magicRoutesTraced: mRes.routesTracedFromMagicRails,
      };
    } else if (synthesisOptions.snapSurfaceTransit && streets.length > 0) {
      const sRes = tracePublicTransitOverStreets(rawRoutesWithStationMoves, streets);
      baseResult = { ...sRes, magicRoutesTraced: 0 };
    } else {
      const mFallback = traceRoutesFromMagicRails(
        rawRoutesWithStationMoves,
        [],
        magicVehiclesCount
      );
      baseResult = {
        tracedRoutes: mFallback.routes,
        routesSnapped: 0,
        totalSurfaceRoutes: rawRoutesWithStationMoves.filter(
          (r) => r.kind !== 'metro' && r.kind !== 'rail'
        ).length,
        avgStreetCoveragePct: 0,
        magicRoutesTraced: 0,
      };
    }

    const routeOverrides = edits.routeOverrides ?? {};
    if (Object.keys(routeOverrides).length === 0) return baseResult;

    return {
      ...baseResult,
      tracedRoutes: baseResult.tracedRoutes.map((rt) => {
        const ov = routeOverrides[rt.id];
        if (!ov || ov.points.length < 2) return rt;
        const baseY = rt.stops[0]?.y ?? SERVER_GROUND_Y;
        const pts3D: WorldPoint3D[] =
          ov.points3D && ov.points3D.length === ov.points.length
            ? ov.points3D
            : ov.points.map((p) => ({ x: p.x, y: baseY, z: p.z }));
        return {
          ...rt,
          tracedPath: ov.points,
          tracedPath3D: pts3D,
          corridorOffset: 0,
        };
      }),
    };
  }, [
    rawRoutesWithStationMoves,
    streets,
    magicRails,
    magicVehiclesCount,
    synthesisOptions.snapSurfaceTransit,
    edits.routeOverrides,
  ]);

  const routes = tracedTransitResult.tracedRoutes;

  const magicStatus: MagicApiStatus = useMemo(
    () => ({
      mode: magicMode,
      railsLoaded: magicRails.length,
      routesTracedFromRails: tracedTransitResult.magicRoutesTraced,
      totalRoutes: rawRoutes.length,
      liveVehiclesCount: magicVehiclesCount,
      endpoint: magicEndpoint,
      diagnostic: magicDiagnostic,
    }),
    [
      magicMode,
      magicRails.length,
      tracedTransitResult.magicRoutesTraced,
      rawRoutes.length,
      magicVehiclesCount,
      magicEndpoint,
      magicDiagnostic,
    ]
  );

  // Camera & visual state
  const [camera, setCamera] = useState<CameraState>({
    x: MURS_DEFAULT_CENTER.x,
    z: MURS_DEFAULT_CENTER.z,
    zoom: 0.42,
    pitch: 46,
    bearing: 0,
  });
  const [darkMode, setDarkMode] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyleMode>('vector');
  const cursorSpanRef = useRef<HTMLSpanElement | null>(null);
  const handleCursorMove = useCallback((pt: WorldPoint) => {
    if (cursorSpanRef.current) {
      cursorSpanRef.current.textContent = `X: ${Math.round(pt.x)} · Z: ${Math.round(pt.z)}`;
    }
  }, []);

  const [layers, setLayers] = useState<MapLayerVisibility>({
    buildings3D: true,
    mtrLines: true,
    liveVehicles: true,
    streetLabels: true,
    addressNumbers: true,
    metroOnly: false,
    blueMapUnderlay: false,
    elevation3D: true,
    terrainRelief: false,
    insolation: false,
  });

  const [insolation, setInsolation] = useState<SolarInsolationState>(() => {
    const now = getCurrentKaliningradDateTime();
    return {
      enabled: false,
      dateIso: now.dateIso,
      minutesOfDay: now.minutesOfDay,
      useLiveTime: true,
      isPlaying: false,
      shadowStrength: 0.72,
    };
  });

  const handleToggleInsolation = useCallback(() => {
    setInsolation((prev) => {
      const nextEnabled = !prev.enabled;
      const now = nextEnabled && prev.useLiveTime ? getCurrentKaliningradDateTime() : null;
      setLayers((l) => ({ ...l, insolation: nextEnabled }));
      return {
        ...prev,
        enabled: nextEnabled,
        isPlaying: nextEnabled ? prev.isPlaying : false,
        ...(now ? { dateIso: now.dateIso, minutesOfDay: now.minutesOfDay } : {}),
      };
    });
  }, []);

  // Keep live Kaliningrad time synced when Insolation is active in live mode
  useEffect(() => {
    if (!insolation.enabled || !insolation.useLiveTime || insolation.isPlaying) return;
    const sync = () => {
      const now = getCurrentKaliningradDateTime();
      setInsolation((prev) =>
        prev.useLiveTime
          ? { ...prev, dateIso: now.dateIso, minutesOfDay: now.minutesOfDay }
          : prev
      );
    };
    const timer = window.setInterval(sync, 20000);
    return () => window.clearInterval(timer);
  }, [insolation.enabled, insolation.useLiveTime, insolation.isPlaying]);

  // Smooth diurnal sun animation when Play is active
  useEffect(() => {
    if (!insolation.enabled || !insolation.isPlaying) return;
    let rafId = 0;
    let lastTs = performance.now();
    const step = (ts: number) => {
      const dtSec = Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;
      setInsolation((prev) => {
        if (!prev.enabled || !prev.isPlaying) return prev;
        // ~150 simulated minutes per second (full 24h cycle in ~9.6s)
        const nextMins = (prev.minutesOfDay + dtSec * 150) % 1440;
        return { ...prev, minutesOfDay: nextMins, useLiveTime: false };
      });
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [insolation.enabled, insolation.isPlaying]);

  // Sidebar, Mobile Draggable Bottom-Sheet Slider, Graphical Editor mode, Photo Mode & search state
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 640
  );
  const [mobileSheetSnap, setMobileSheetSnap] = useState<'collapsed' | 'compact' | 'expanded'>(
    'collapsed'
  );
  const [mobileDragDeltaY, setMobileDragDeltaY] = useState(0);
  const [mobileDragging, setMobileDragging] = useState(false);
  const mobileDragStartRef = useRef<{
    y: number;
    startSnap: 'collapsed' | 'compact' | 'expanded';
    pointerId: number;
  } | null>(null);

  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [isEditorMode, setIsEditorMode] = useState(false);
  const [photoMode, setPhotoMode] = useState(false);
  const [photoHintVisible, setPhotoHintVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>('explore');
  const [searchQuery, setSearchQuery] = useState('');
  const [exploreFilter, setExploreFilter] = useState<'all' | 'metro' | 'addresses'>('all');
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);

  // Routing & user local time state
  const [pointA, setPointA] = useState<RouteEndpoint | null>(null);
  const [pointB, setPointB] = useState<RouteEndpoint | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>('transit');
  const [simVehicle, setSimVehicle] = useState<SimVehicleType>('scooter');
  const [selectedTransitIdx, setSelectedTransitIdx] = useState(0);
  const [pickMode, setPickMode] = useState<'A' | 'B' | null>(null);
  const [departureTimeMode, setDepartureTimeMode] = useState<'now' | 'custom'>('now');
  const [customDepartureTime, setCustomDepartureTime] = useState<string>(() =>
    formatLocalTimeRu(Date.now())
  );
  const [liveClockNowMs, setLiveClockNowMs] = useState<number>(() => Date.now());

  // Graphical Editor state
  const [editorTool, setEditorTool] = useState<EditorTool>('select');
  const [snapToRoad, setSnapToRoad] = useState(true);
  const [snapToBuilding, setSnapToBuilding] = useState(true);
  const [snapToLand, setSnapToLand] = useState(true);
  const [autoHouseNumbering, setAutoHouseNumbering] = useState(true);
  const [lastEditorNotice, setLastEditorNotice] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const saveFileInputRef = useRef<HTMLInputElement | null>(null);
  const [draftBuildingCenter, setDraftBuildingCenter] = useState<WorldPoint | null>(null);
  const [draftBuildingPolygon, setDraftBuildingPolygon] = useState<WorldPoint[]>([]);
  const [draftBuildingSize, setDraftBuildingSize] = useState<{
    width: number;
    depth: number;
    floors: number;
    angle: number;
    shape?: 'rect' | 'circle' | 'triangle' | 'parallelogram' | 'polygon';
    triangleCorner?: 0 | 1 | 2 | 3;
    skewDeg?: number;
  }>({
    width: 84,
    depth: 56,
    floors: 7,
    angle: 0,
    shape: 'rect',
    triangleCorner: 0,
    skewDeg: 25,
  });
  const [draftStreetPoints, setDraftStreetPoints] = useState<WorldPoint[]>([]);
  const [draftStreetPoints3D, setDraftStreetPoints3D] = useState<WorldPoint3D[]>([]);
  const [draftStreetElevationY, setDraftStreetElevationY] = useState<number>(SERVER_GROUND_Y);
  const [draftStreetRoadClass, setDraftStreetRoadClass] = useState<RoadClass>('street');
  const [draftStreetOneWay, setDraftStreetOneWay] = useState<OneWayDirection>('none');
  const [draftPlaceCenter, setDraftPlaceCenter] = useState<WorldPoint | null>(null);
  const [draftPlaceTier, setDraftPlaceTier] = useState<SettlementTier>('district');
  const [draftLandPoints, setDraftLandPoints] = useState<WorldPoint[]>([]);
  const [draftLandKind, setDraftLandKind] = useState<'park' | 'water' | 'square'>('park');
  const [draftPoiCenter, setDraftPoiCenter] = useState<WorldPoint | null>(null);
  const [draftPoiIcon, setDraftPoiIcon] = useState<PoiIconKind>('star');
  const [activeWingId, setActiveWingId] = useState<string | null>(null);
  const [isDrawingWing, setIsDrawingWing] = useState(false);
  const [mergeSourceBuildingId, setMergeSourceBuildingId] = useState<string | null>(null);
  const [multiSelectedItems, setMultiSelectedItems] = useState<MultiSelectedItem[]>([]);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const multiSelectedBuildingIds = useMemo(
    () => multiSelectedItems.filter((it) => it.type === 'building').map((it) => it.id),
    [multiSelectedItems]
  );
  const stationCombinedModesMap = useMemo(
    () => buildStationCombinedModesMap(stations),
    [stations]
  );
  const rawTileImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Auto-hide subtle Esc hint shortly after entering Photo Mode
  useEffect(() => {
    if (!photoMode) {
      setPhotoHintVisible(false);
      return;
    }
    setPhotoHintVisible(true);
    const t = window.setTimeout(() => setPhotoHintVisible(false), 3200);
    return () => window.clearTimeout(t);
  }, [photoMode]);

  // Keep user's local clock ticked every 30s so "Сейчас" departure times stay accurate
  useEffect(() => {
    const id = window.setInterval(() => setLiveClockNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const effectiveDepartureMs = useMemo(() => {
    if (departureTimeMode === 'custom') {
      return parseLocalTimeInputToEpochMs(customDepartureTime, liveClockNowMs);
    }
    return liveClockNowMs;
  }, [departureTimeMode, customDepartureTime, liveClockNowMs]);

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Persist edits helper (localStorage for compact payloads + debounced /api/edits + undo/redo history)
  const persistEdits = useCallback(
    (next: MapEditsPayload, immediate = true, recordUndo = true) => {
      if (recordUndo) {
        const snapshot = editsRef.current;
        setUndoStack((prev) => [...prev.slice(-24), snapshot]);
        setRedoStack([]);
      }
      const stamped: MapEditsPayload = {
        ...EMPTY_EDITS,
        ...next,
        updatedAt: new Date().toISOString(),
      };
      editsRef.current = stamped;
      setEdits(stamped);
      if (saveDebounceRef.current) {
        window.clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      const flushPersist = () => {
        let serialized = '';
        try {
          serialized = JSON.stringify(stamped);
        } catch {
          return;
        }
        if (serialized.length <= 1_200_000) {
          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
          } catch {
            // ignore storage quota errors
          }
        } else {
          try {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
          } catch {
            // ignore
          }
        }
        fetch('/api/edits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serialized,
        }).catch(() => {});
      };
      // Always defer JSON serialization off the interactive frame
      saveDebounceRef.current = window.setTimeout(flushPersist, immediate ? 40 : 320);
    },
    []
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      const current = editsRef.current;
      setRedoStack((rPrev) => [...rPrev.slice(-24), current]);
      persistEdits(previous, true, false);
      setLastEditorNotice('Последнее действие отменено');
      return prev.slice(0, -1);
    });
  }, [persistEdits]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const nextState = prev[prev.length - 1];
      const current = editsRef.current;
      setUndoStack((uPrev) => [...uPrev.slice(-24), current]);
      persistEdits(nextState, true, false);
      setLastEditorNotice('Отменённое действие возвращено');
      return prev.slice(0, -1);
    });
  }, [persistEdits]);

  const dragUndoPendingRef = useRef<MapEditsPayload | null>(null);
  const handleBeginDragEdit = useCallback(() => {
    dragUndoPendingRef.current = editsRef.current;
  }, []);

  const handleEndDragEdit = useCallback(() => {
    const preDrag = dragUndoPendingRef.current;
    dragUndoPendingRef.current = null;
    if (preDrag && preDrag !== editsRef.current) {
      setUndoStack((prev) => [...prev.slice(-24), preDrag]);
      setRedoStack([]);
    }
    persistEdits(editsRef.current, true, false);
  }, [persistEdits]);

  // Load persisted server edits & live transit data on mount
  useEffect(() => {
    let cancelled = false;

    fetch('/api/edits')
      .then((r) => (r.ok ? r.json() : null))
      .then((serverEdits: MapEditsPayload | null) => {
        if (cancelled || !serverEdits) return;
        const local = loadLocalEdits();
        const serverHasData =
          (serverEdits.buildings?.length || 0) > 0 ||
          (serverEdits.streets?.length || 0) > 0 ||
          (serverEdits.landFeatures?.length || 0) > 0 ||
          (serverEdits.pois?.length || 0) > 0 ||
          Object.keys(serverEdits.stationOverrides || {}).length > 0 ||
          Object.keys(serverEdits.routeOverrides || {}).length > 0 ||
          (serverEdits.deletedBuildingIds?.length || 0) > 0;
        const localHasData =
          local.buildings.length > 0 ||
          local.streets.length > 0 ||
          (local.landFeatures?.length || 0) > 0 ||
          (local.pois?.length || 0) > 0 ||
          Object.keys(local.stationOverrides || {}).length > 0 ||
          Object.keys(local.routeOverrides || {}).length > 0 ||
          local.deletedBuildingIds.length > 0;
        if (serverHasData && (!localHasData || serverEdits.updatedAt > local.updatedAt)) {
          const normalized = { ...EMPTY_EDITS, ...serverEdits };
          editsRef.current = normalized;
          setEdits(normalized);
          if (normalized.buildings.length < 400) {
            try {
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
            } catch {
              // ignore
            }
          }
        }
      })
      .catch(() => {});

    const tryDirectBrowserMagicFetch = async (): Promise<{
      rails: MagicRailSegment[];
      vehiclesCount: number;
      endpoint: string;
    } | null> => {
      const candidates = [
        'https://map.murs-mc.ru:8088/api/rails?dimension=0',
        'https://map.murs-mc.ru:8088/livemap/api/rails?dimension=0',
        ...(typeof window !== 'undefined' && window.location.protocol === 'http:'
          ? [
              'http://map.murs-mc.ru:8088/api/rails?dimension=0',
              'http://map.murs-mc.ru:8088/livemap/api/rails?dimension=0',
            ]
          : []),
      ];
      for (const url of candidates) {
        try {
          const ctrl = new AbortController();
          const timer = window.setTimeout(() => ctrl.abort(), 3500);
          const resp = await fetch(url, { signal: ctrl.signal });
          window.clearTimeout(timer);
          if (!resp.ok) continue;
          const json = await resp.json();
          const parsed = parseMagicRailsPayload(json);
          if (parsed.rails.length > 0) {
            return {
              rails: parsed.rails,
              vehiclesCount: parsed.vehicles.length,
              endpoint: url,
            };
          }
        } catch {
          // try next endpoint
        }
      }
      return null;
    };

    const applyMagicResponse = (magicRes: any) => {
      if (!magicRes?.payload) return false;
      const p = magicRes.payload;
      if (typeof p.endpoint === 'string' && p.endpoint) {
        setMagicEndpoint(p.endpoint);
      }
      setMagicDiagnostic(typeof p.diagnostic === 'string' ? p.diagnostic : undefined);
      const parsedMagic = parseMagicRailsPayload(p);
      if (parsedMagic.rails.length > 0) {
        setMagicRails(parsedMagic.rails);
        setMagicVehiclesCount(parsedMagic.vehicles.length);
        setMagicMode('magic-rails-live');
        setMagicDiagnostic(undefined);
        return true;
      } else if (p.mode === 'magic-jme-3d') {
        setMagicMode('magic-jme-3d');
      } else {
        setMagicMode('magic-fallback');
      }
      return false;
    };

    Promise.all([
      fetch('/api/mtr/stations-and-routes').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/mtr/departures').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/magic/tracks').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([srRes, depRes, magicRes]) => {
        if (cancelled) return;
        const loadedFromProxy = applyMagicResponse(magicRes);
        if (!loadedFromProxy) {
          tryDirectBrowserMagicFetch()
            .then((direct) => {
              if (cancelled || !direct) return;
              setMagicRails(direct.rails);
              setMagicVehiclesCount(direct.vehiclesCount);
              setMagicEndpoint(direct.endpoint);
              setMagicMode('magic-rails-live');
            })
            .catch(() => {});
        }
        const primaryPayload =
          srRes?.payload ??
          (magicRes?.payload?.data ? { data: magicRes.payload.data } : null);
        if (!primaryPayload) return;
        const depPayload = depRes?.payload as RawDeparturesPayload | undefined;
        const depMap = parseDeparturesPayload(depPayload);
        if (depMap.size > 0) {
          setDeparturesMap(depMap);
          setServerClockOffsetMs(extractServerClockOffsetMs(depPayload, Date.now()));
        }
        const parsed = parseMtrStationsAndRoutes(primaryPayload as RawMtrPayload, depMap);
        if (parsed.stations.length >= 10 && parsed.routes.length >= 5) {
          setRawStations(parsed.stations);
          setRawRoutes(parsed.routes);
          setMtrSource('live');
        }
      })
      .catch(() => {});

    // Periodically refresh real MTR departures so live transit positions & wait times stay synced
    const depRefreshId = window.setInterval(() => {
      fetch('/api/mtr/departures')
        .then((r) => (r.ok ? r.json() : null))
        .then((depRes) => {
          if (cancelled || !depRes?.payload) return;
          const depPayload = depRes.payload as RawDeparturesPayload;
          const depMap = parseDeparturesPayload(depPayload);
          if (depMap.size > 0) {
            setDeparturesMap(depMap);
            setServerClockOffsetMs(extractServerClockOffsetMs(depPayload, Date.now()));
          }
        })
        .catch(() => {});
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(depRefreshId);
    };
  }, []);

  const handleRefreshMagicApi = useCallback(async () => {
    setMagicRefreshing(true);
    try {
      let loaded = false;
      const res = await fetch('/api/magic/tracks?refresh=1');
      if (res.ok) {
        const magicRes = await res.json();
        const p = magicRes?.payload;
        if (p) {
          if (typeof p.endpoint === 'string') setMagicEndpoint(p.endpoint);
          setMagicDiagnostic(typeof p.diagnostic === 'string' ? p.diagnostic : undefined);
          const parsedMagic = parseMagicRailsPayload(p);
          if (parsedMagic.rails.length > 0) {
            setMagicRails(parsedMagic.rails);
            setMagicVehiclesCount(parsedMagic.vehicles.length);
            setMagicMode('magic-rails-live');
            setMagicDiagnostic(undefined);
            loaded = true;
          } else {
            setMagicMode(p.mode === 'magic-jme-3d' ? 'magic-jme-3d' : 'magic-fallback');
          }
        }
      }
      if (!loaded) {
        const directUrls = [
          'https://map.murs-mc.ru:8088/api/rails?dimension=0',
          'https://map.murs-mc.ru:8088/livemap/api/rails?dimension=0',
          ...(typeof window !== 'undefined' && window.location.protocol === 'http:'
            ? [
                'http://map.murs-mc.ru:8088/api/rails?dimension=0',
                'http://map.murs-mc.ru:8088/livemap/api/rails?dimension=0',
              ]
            : []),
        ];
        for (const url of directUrls) {
          try {
            const ctrl = new AbortController();
            const timer = window.setTimeout(() => ctrl.abort(), 3500);
            const directRes = await fetch(url, { signal: ctrl.signal });
            window.clearTimeout(timer);
            if (!directRes.ok) continue;
            const json = await directRes.json();
            const parsedMagic = parseMagicRailsPayload(json);
            if (parsedMagic.rails.length > 0) {
              setMagicRails(parsedMagic.rails);
              setMagicVehiclesCount(parsedMagic.vehicles.length);
              setMagicEndpoint(url);
              setMagicMode('magic-rails-live');
              break;
            }
          } catch {
            // continue to next candidate
          }
        }
      }
    } catch {
      // keep current state
    } finally {
      setMagicRefreshing(false);
    }
  }, []);

  const handleImportMagicJson = useCallback((jsonText: string): { ok: boolean; message: string } => {
    try {
      const parsed = JSON.parse(jsonText);
      const { rails, vehicles } = parseMagicRailsPayload(parsed);
      if (rails.length === 0) {
        return {
          ok: false,
          message: 'В файле не найдены трассировки линий транспорта.',
        };
      }
      setMagicRails(rails);
      setMagicVehiclesCount(vehicles.length);
      setMagicMode('magic-rails-imported');
      setMagicDiagnostic(undefined);
      return {
        ok: true,
        message: `Загружено ${rails.length} участков трасс${vehicles.length ? ` и ${vehicles.length} ед. транспорта` : ''}.`,
      };
    } catch {
      return { ok: false, message: 'Не удалось прочитать файл маршрутов.' };
    }
  }, []);

  // Commit unsaved synthesized buildings & streets permanently to persisted map data (localStorage + /api/edits)
  const commitSynthesizedToMap = useCallback(
    (newBuildings: Building3D[], newStreets: StreetSegment[]) => {
      if (newBuildings.length === 0 && newStreets.length === 0) return;
      const cur = editsRef.current;
      const bMap = new Map(cur.buildings.map((b) => [b.id, b]));
      for (const b of newBuildings) {
        bMap.set(b.id, { ...b, isUserEdited: true });
      }
      const sMap = new Map(cur.streets.map((s) => [s.id, s]));
      for (const s of newStreets) {
        sMap.set(s.id, { ...s, isUserEdited: true });
      }
      const addedBIds = new Set(newBuildings.map((b) => b.id));
      const addedSIds = new Set(newStreets.map((s) => s.id));
      const next: MapEditsPayload = {
        ...cur,
        buildings: Array.from(bMap.values()),
        streets: Array.from(sMap.values()),
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => !addedBIds.has(id)),
        deletedStreetIds: cur.deletedStreetIds.filter((id) => !addedSIds.has(id)),
        updatedAt: new Date().toISOString(),
      };
      persistEdits(next, true);
      setAutoBuildings((prev) => prev.filter((b) => !addedBIds.has(b.id)));
      setAutoStreets((prev) => prev.filter((s) => !addedSIds.has(s.id)));
      setSaveSynthNotice(
        `Сохранено на карту: +${newBuildings.length} зд., +${newStreets.length} ул. (данные сохранятся после перезагрузки)`
      );
    },
    [persistEdits]
  );

  // Multi-LOD User-Selected Arbitrary Polygon BlueMap 3D Urban Synthesis Runner
  const runBlueMapSynthesis = useCallback(
    async (
      polygon: WorldPoint[],
      opts: Required<SynthesisOptions>,
      autoSaveOverride?: boolean
    ) => {
      const cropBounds = computePolygonBounds(polygon);
      if (!cropBounds || polygon.length < 3) {
        setSynthesisError('Задайте замкнутый контур области синтеза (минимум 3 вершины).');
        return;
      }

      setSynthesisRunning(true);
      setSynthesisError(null);
      setSaveSynthNotice(null);

      try {
        const lod = opts.tileLod;
        const blocksPerPixel = lod === 1 ? 1 : lod === 2 ? 5 : 25;
        const tileSpan = 500 * blocksPerPixel;

        const widthM = Math.max(1, Math.round(cropBounds.maxX - cropBounds.minX));
        const depthM = Math.max(1, Math.round(cropBounds.maxZ - cropBounds.minZ));
        const maxSide = Math.max(widthM, depthM);
        const centerX = (cropBounds.minX + cropBounds.maxX) * 0.5;
        const centerZ = (cropBounds.minZ + cropBounds.maxZ) * 0.5;
        const effectiveAreaSide = Math.max(1, Math.round(Math.sqrt(widthM * depthM)));

        const minTx = Math.floor(cropBounds.minX / tileSpan);
        const maxTx = Math.floor(cropBounds.maxX / tileSpan);
        const minTz = Math.floor(cropBounds.minZ / tileSpan);
        const maxTz = Math.floor(cropBounds.maxZ / tileSpan);

        const tileCoords: Array<[number, number]> = [];
        for (let tx = minTx; tx <= maxTx; tx++) {
          for (let tz = minTz; tz <= maxTz; tz++) {
            if (tileCoords.length < 36) {
              tileCoords.push([tx, tz]);
            }
          }
        }

        // Choose crisp analysis resolution based on selected area dimensions & LOD
        const cellSize =
          lod === 1
            ? maxSide <= 40
              ? 1
              : maxSide <= 650
              ? 2
              : 3
            : lod === 2
            ? 5
            : 25;

        const loadedTiles: BlueMapTileImage[] = [];
        const grids: HeightColorGrid[] = [];

        await Promise.all(
          tileCoords.map(
            ([tx, tz]) =>
              new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                  let rgbaData: Uint8ClampedArray | undefined;
                  if (img.naturalWidth > 10 && img.naturalHeight > 20) {
                    const offscreen = document.createElement('canvas');
                    offscreen.width = img.naturalWidth;
                    offscreen.height = img.naturalHeight;
                    const octx = offscreen.getContext('2d', { willReadFrequently: true });
                    if (octx) {
                      octx.drawImage(img, 0, 0);
                      const imgData = octx.getImageData(0, 0, offscreen.width, offscreen.height);
                      rgbaData = imgData.data;
                      const decoded = decodeBlueMapTileRgba(
                        rgbaData,
                        offscreen.width,
                        offscreen.height,
                        tx,
                        tz,
                        cellSize,
                        lod,
                        cropBounds
                      );
                      if (decoded.cols > 0 && decoded.rows > 0) {
                        grids.push(decoded);
                      }
                    }
                  }
                  rawTileImagesRef.current.set(`${lod}_${tx}_${tz}`, img);
                  loadedTiles.push(
                    buildTileImage(
                      img,
                      tx,
                      tz,
                      lod,
                      tileSpan,
                      layers.terrainRelief,
                      rgbaData,
                      img.naturalWidth,
                      img.naturalHeight
                    )
                  );
                  resolve();
                };
                img.onerror = () => resolve();
                img.src = `/api/bluemap/tile/${lod}/${tx}/${tz}`;
              })
          )
        );

        if (grids.length === 0) {
          setSynthesisError(
            'Не удалось загрузить данные рельефа и застройки для выделенной области. Выделите участок в пределах Муроморска.'
          );
          setSynthesisRunning(false);
          return;
        }

        const existingSavedBuildings = [...DEFAULT_BUILDINGS, ...editsRef.current.buildings];
        const existingSavedStreets = [...DEFAULT_STREETS, ...editsRef.current.streets];

        const result = runUrbanSynthesisPipeline(
          grids,
          existingSavedBuildings,
          existingSavedStreets,
          [],
          {
            ...opts,
            areaSideBlocks: effectiveAreaSide,
            snapSurfaceTransit: false,
            cropPolygon: polygon,
          },
          'bluemap-live'
        );

        setBlueMapTiles((prev) => {
          const byKey = new Map(prev.map((t) => [`${t.lod}_${t.tx}_${t.tz}`, t]));
          for (const t of loadedTiles) byKey.set(`${t.lod}_${t.tx}_${t.tz}`, t);
          return evictFarthestTiles(Array.from(byKey.values()), centerX, centerZ, 110);
        });

        const nextBuildings =
          opts.targetMode === 'both' || opts.targetMode === 'buildings' ? result.buildings : [];
        const nextStreets =
          opts.targetMode === 'both' || opts.targetMode === 'streets' ? result.streets : [];

        const shouldAutoSave = autoSaveOverride ?? autoSaveSynthesis;
        if (shouldAutoSave && (nextBuildings.length > 0 || nextStreets.length > 0)) {
          commitSynthesizedToMap(nextBuildings, nextStreets);
        } else {
          if (nextBuildings.length > 0) {
            setAutoBuildings((prev) => {
              const byId = new Map(prev.map((b) => [b.id, b]));
              for (const b of nextBuildings) byId.set(b.id, b);
              return Array.from(byId.values());
            });
          }

          if (nextStreets.length > 0) {
            setAutoStreets((prev) => {
              const combined = [...prev, ...nextStreets];
              return mergeAndSmoothRoadNetwork(combined).slice(-1200);
            });
          }
        }

        setSynthesisStats(result.stats);
      } catch (err) {
        setSynthesisError(
          err instanceof Error ? err.message : 'Ошибка при анализе данных местности'
        );
      } finally {
        setSynthesisRunning(false);
      }
    },
    [autoSaveSynthesis, commitSynthesizedToMap, layers.terrainRelief]
  );

  // Dedicated synthesis of Roads and Railway Tracks directly from MAGIC API / MTR 3D trajectories
  const handleRunMagicTrajectorySynthesis = useCallback(
    (opts: { includeRoads: boolean; includeRailways: boolean; onlyInZone: boolean }) => {
      const activePoly =
        opts.onlyInZone && isSynthesisPolygonClosed && synthesisPolygon.length >= 3
          ? synthesisPolygon
          : undefined;
      const cropBounds = activePoly ? computePolygonBounds(activePoly) ?? undefined : undefined;

      const res = synthesizeRoadsAndRailsFromMagic(routes, magicRails, {
        includeRoads: opts.includeRoads,
        includeRailways: opts.includeRailways,
        cropBounds,
        cropPolygon: activePoly,
      });

      if (res.allSegments.length > 0) {
        if (autoSaveSynthesis) {
          commitSynthesizedToMap([], res.allSegments);
        } else {
          setAutoStreets((prev) => {
            const existingNonMagic = prev.filter((s) => !s.id.startsWith('magic-'));
            return [...existingNonMagic, ...res.allSegments].slice(-1400);
          });
          setSaveSynthNotice(
            `Синтезировано по траекториям MAGIC: ${res.roads.length} автодорог, ${res.railways.length} ЖД путей`
          );
        }
      }

      return {
        roadsCount: res.roads.length,
        railwaysCount: res.railways.length,
        sourceMode: res.sourceMode,
      };
    },
    [
      synthesisPolygon,
      isSynthesisPolygonClosed,
      routes,
      magicRails,
      autoSaveSynthesis,
      commitSynthesizedToMap,
    ]
  );

  const handleAddSynthesisVertex = useCallback(
    (pt: WorldPoint) => {
      const snapped = { x: Math.round(pt.x), z: Math.round(pt.z) };
      setSynthesisError(null);
      if (isSynthesisPolygonClosed) {
        setSynthesisPolygon([snapped]);
        setIsSynthesisPolygonClosed(false);
        setIsSelectingSynthesisArea(true);
      } else {
        setSynthesisPolygon((prev) => [...prev, snapped]);
        setIsSelectingSynthesisArea(true);
      }
    },
    [isSynthesisPolygonClosed]
  );

  const handleMoveSynthesisVertex = useCallback((idx: number, pt: WorldPoint) => {
    setSynthesisPolygon((prev) =>
      prev.map((v, i) => (i === idx ? { x: Math.round(pt.x), z: Math.round(pt.z) } : v))
    );
  }, []);

  const handleFinishSynthesisPolygon = useCallback(() => {
    if (synthesisPolygon.length < 3) return;
    setIsSynthesisPolygonClosed(true);
    setIsSelectingSynthesisArea(false);
    setSynthesisError(null);
    const bounds = computePolygonBounds(synthesisPolygon);
    if (!bounds) return;
    const w = Math.max(1, Math.round(bounds.maxX - bounds.minX));
    const d = Math.max(1, Math.round(bounds.maxZ - bounds.minZ));
    const maxSide = Math.max(w, d);
    setSynthesisOptions((prev) => ({
      ...prev,
      areaSideBlocks: Math.max(1, Math.round(Math.sqrt(w * d))),
      tileLod: maxSide >= 2200 ? (Math.max(2, prev.tileLod) as 1 | 2 | 3) : prev.tileLod,
      minBuildingAreaBlocks:
        maxSide <= 25 ? Math.min(prev.minBuildingAreaBlocks, 1) : prev.minBuildingAreaBlocks,
    }));
  }, [synthesisPolygon]);

  const handlePopSynthesisVertex = useCallback(() => {
    setSynthesisPolygon((prev) => {
      const next = prev.slice(0, -1);
      if (next.length < 3) setIsSynthesisPolygonClosed(false);
      return next;
    });
  }, []);

  // Live frustum-aware multi-LOD BlueMap tile fetcher at the user's current camera position
  const blueMapTilesRef = useRef<BlueMapTileImage[]>(blueMapTiles);
  blueMapTilesRef.current = blueMapTiles;
  const inFlightTileKeysRef = useRef<Set<string>>(new Set());
  const camTileQuantX = Math.floor(camera.x / 180);
  const camTileQuantZ = Math.floor(camera.z / 180);
  const camZoomBucket = Math.round(camera.zoom * 8);
  const camPitchBucket = Math.round(camera.pitch / 15);
  const camBearingBucket = Math.round(camera.bearing / 45);

  useEffect(() => {
    if (
      mapStyle !== 'hybrid' &&
      mapStyle !== 'bluemap' &&
      !layers.blueMapUnderlay &&
      !layers.terrainRelief
    ) {
      return;
    }

    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const frustum = computeViewportWorldBounds(camera, vw, vh, 320);

    const existingKeys = new Set(
      blueMapTilesRef.current.map((t) => `${t.lod}_${t.tx}_${t.tz}`)
    );
    const toFetch: Array<{ lod: 1 | 2; tx: number; tz: number; span: number; key: string }> = [];

    // 1. High-res LOD 1 (500-block tiles) centered on user's live camera position & frustum
    const minTx1 = Math.floor(frustum.minX / 500);
    const maxTx1 = Math.floor(frustum.maxX / 500);
    const minTz1 = Math.floor(frustum.minZ / 500);
    const maxTz1 = Math.floor(frustum.maxZ / 500);
    const cx1 = Math.floor(camera.x / 500);
    const cz1 = Math.floor(camera.z / 500);

    const lod1Candidates: Array<{ tx: number; tz: number; dist: number }> = [];
    for (let tx = Math.max(cx1 - 3, minTx1); tx <= Math.min(cx1 + 3, maxTx1); tx++) {
      for (let tz = Math.max(cz1 - 3, minTz1); tz <= Math.min(cz1 + 3, maxTz1); tz++) {
        lod1Candidates.push({ tx, tz, dist: Math.hypot(tx - cx1, tz - cz1) });
      }
    }
    lod1Candidates.sort((a, b) => a.dist - b.dist);
    for (const c of lod1Candidates.slice(0, 24)) {
      const key = `1_${c.tx}_${c.tz}`;
      if (!existingKeys.has(key) && !inFlightTileKeysRef.current.has(key)) {
        inFlightTileKeysRef.current.add(key);
        toFetch.push({ lod: 1, tx: c.tx, tz: c.tz, span: 500, key });
      }
    }

    // 2. Coarse LOD 2 (2500-block background tiles) for immediate horizon fill & wide zoom
    const minTx2 = Math.floor(frustum.minX / 2500);
    const maxTx2 = Math.floor(frustum.maxX / 2500);
    const minTz2 = Math.floor(frustum.minZ / 2500);
    const maxTz2 = Math.floor(frustum.maxZ / 2500);
    const cx2 = Math.floor(camera.x / 2500);
    const cz2 = Math.floor(camera.z / 2500);
    for (let tx = Math.max(cx2 - 1, minTx2); tx <= Math.min(cx2 + 1, maxTx2); tx++) {
      for (let tz = Math.max(cz2 - 1, minTz2); tz <= Math.min(cz2 + 1, maxTz2); tz++) {
        const key = `2_${tx}_${tz}`;
        if (!existingKeys.has(key) && !inFlightTileKeysRef.current.has(key)) {
          inFlightTileKeysRef.current.add(key);
          toFetch.push({ lod: 2, tx, tz, span: 2500, key });
        }
      }
    }

    if (toFetch.length === 0) return;

    const decodeReliefNow = layers.terrainRelief;
    const camSnapX = camera.x;
    const camSnapZ = camera.z;

    for (const item of toFetch) {
      const { lod, tx, tz, span, key } = item;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        inFlightTileKeysRef.current.delete(key);
        if (rawTileImagesRef.current.size > 110) {
          const oldestKey = rawTileImagesRef.current.keys().next().value;
          if (oldestKey) rawTileImagesRef.current.delete(oldestKey);
        }
        rawTileImagesRef.current.set(key, img);
        const built = buildTileImage(img, tx, tz, lod, span, decodeReliefNow);
        setBlueMapTiles((prev) => {
          const byKey = new Map(prev.map((t) => [`${t.lod}_${t.tx}_${t.tz}`, t]));
          byKey.set(key, built);
          return evictFarthestTiles(Array.from(byKey.values()), camSnapX, camSnapZ, 110);
        });
      };
      img.onerror = () => {
        inFlightTileKeysRef.current.delete(key);
      };
      img.src = `/api/bluemap/tile/${lod}/${tx}/${tz}`;
    }
  }, [
    mapStyle,
    layers.blueMapUnderlay,
    layers.terrainRelief,
    camTileQuantX,
    camTileQuantZ,
    camZoomBucket,
    camPitchBucket,
    camBearingBucket,
  ]);

  // Lazily decode terrain relief canvases ONLY when user turns Terrain Relief layer ON
  useEffect(() => {
    if (!layers.terrainRelief) return;
    setBlueMapTiles((prev) => {
      let changed = false;
      const next = prev.map((tile) => {
        if (tile.terrain) return tile;
        const key = `${tile.lod}_${tile.tx}_${tile.tz}`;
        const rawImg = rawTileImagesRef.current.get(key);
        if (!rawImg) return tile;
        const terrain = decodeTerrainFromImage(rawImg, tile.tx, tile.tz, tile.lod);
        if (!terrain) return tile;
        changed = true;
        return { ...tile, terrain };
      });
      return changed ? next : prev;
    });
  }, [layers.terrainRelief]);

  // Multimodal Route Computations (memoized across all 4 modes with real MTR schedule & user's local time)
  const transitRoutes = useMemo(() => {
    if (!pointA || !pointB) return [];
    return computeTransitRoutes(
      pointA,
      pointB,
      stations,
      routes,
      streets,
      buildings,
      landFeatures,
      effectiveDepartureMs,
      departuresMap,
      serverClockOffsetMs
    );
  }, [
    pointA,
    pointB,
    stations,
    routes,
    streets,
    buildings,
    landFeatures,
    effectiveDepartureMs,
    departuresMap,
    serverClockOffsetMs,
  ]);

  const autoRoute = useMemo(() => {
    if (!pointA || !pointB) return null;
    return computeStreetRoute(
      pointA,
      pointB,
      streets,
      'auto',
      'scooter',
      buildings,
      landFeatures,
      effectiveDepartureMs
    );
  }, [pointA, pointB, streets, buildings, landFeatures, effectiveDepartureMs]);

  const walkRoute = useMemo(() => {
    if (!pointA || !pointB) return null;
    return computeStreetRoute(
      pointA,
      pointB,
      streets,
      'walk',
      'scooter',
      buildings,
      landFeatures,
      effectiveDepartureMs
    );
  }, [pointA, pointB, streets, buildings, landFeatures, effectiveDepartureMs]);

  const simRoute = useMemo(() => {
    if (!pointA || !pointB) return null;
    return computeStreetRoute(
      pointA,
      pointB,
      streets,
      'sim',
      simVehicle,
      buildings,
      landFeatures,
      effectiveDepartureMs
    );
  }, [pointA, pointB, streets, simVehicle, buildings, landFeatures, effectiveDepartureMs]);

  useEffect(() => {
    setSelectedTransitIdx(0);
  }, [pointA, pointB]);

  const activeRoute = useMemo(() => {
    if (!pointA || !pointB) return null;
    if (travelMode === 'transit') {
      return transitRoutes[selectedTransitIdx] ?? transitRoutes[0] ?? null;
    }
    if (travelMode === 'auto') return autoRoute;
    if (travelMode === 'walk') return walkRoute;
    return simRoute;
  }, [pointA, pointB, travelMode, transitRoutes, selectedTransitIdx, autoRoute, walkRoute, simRoute]);

  // Fit camera when a new route is built
  const frameRouteEndpoints = useCallback((a: RouteEndpoint, b: RouteEndpoint) => {
    const cx = (a.x + b.x) * 0.5;
    const cz = (a.z + b.z) * 0.5;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const fitZoom = Math.max(0.11, Math.min(0.55, 520 / Math.max(300, dist)));
    setCamera((c) => ({ ...c, x: cx, z: cz, zoom: fitZoom }));
  }, []);

  const flyTo = useCallback((x: number, z: number, zoom?: number) => {
    setCamera((c) => ({ ...c, x, z, zoom: zoom ?? Math.max(c.zoom, 0.48) }));
  }, []);

  // Smart global search (abbreviations, building category keywords, POIs, addresses, stations, coordinates)
  const searchResults = useMemo(() => {
    return searchMapEntities(searchQuery, { stations, buildings, streets, pois }, 18);
  }, [searchQuery, stations, buildings, streets, pois]);

  // Filtered directory in Explore tab
  const metroStationsList = useMemo(
    () =>
      stations
        .filter((s) => s.kinds.includes('metro'))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [stations]
  );

  // Handlers
  const handleSelectEntity = useCallback(
    (entity: SelectedEntity | null) => {
      setSelectedEntity(entity);
      setIsDrawingWing(false);
      setMergeSourceBuildingId(null);
      setMultiSelectedItems([]);
      if (entity?.type === 'building') {
        const wings = getBuildingWings(entity.data);
        setActiveWingId(wings[0]?.id ?? null);
      } else {
        setActiveWingId(null);
      }
      if (!entity) return;
      if (!isEditorMode) {
        setSidebarOpen(true);
        setMobileSheetSnap('compact');
        if (activeTab === 'route') {
          setActiveTab('explore');
        }
      }
    },
    [activeTab, isEditorMode]
  );

  const handleSelectBuildingWithWing = useCallback(
    (building: Building3D, wingId: string) => {
      setSelectedEntity({ type: 'building', data: building });
      setActiveWingId(wingId);
      setIsDrawingWing(false);
      setMergeSourceBuildingId(null);
      setMultiSelectedItems([]);
      if (!isEditorMode) {
        setSidebarOpen(true);
        setMobileSheetSnap('compact');
        if (activeTab === 'route') {
          setActiveTab('explore');
        }
      }
    },
    [activeTab, isEditorMode]
  );

  const handleOpenBlueMapAt = useCallback(
    (pt: WorldPoint) => {
      setMapStyle('bluemap');
      flyTo(pt.x, pt.z, Math.max(camera.zoom, 0.55));
    },
    [flyTo, camera.zoom]
  );

  const handleSavePoi = useCallback(
    (poi: MapPoi) => {
      const cur = editsRef.current;
      const existing = cur.pois ?? [];
      const isUpdatingExisting = existing.some((p) => p.id === poi.id);
      const filtered = existing.filter((p) => p.id !== poi.id);
      const next: MapEditsPayload = {
        ...cur,
        pois: [...filtered, { ...poi, isUserEdited: true }],
        deletedPoiIds: (cur.deletedPoiIds ?? []).filter((id) => id !== poi.id),
      };
      persistEdits(next);
      setSelectedEntity({ type: 'poi', data: poi });
      if (isUpdatingExisting || editorTool !== 'add-poi') {
        setEditorTool('select');
      } else {
        setLastEditorNotice(`Метка «${poi.name}» добавлена — кликните ещё или измените название`);
      }
    },
    [persistEdits, editorTool]
  );

  const handleDeletePoi = useCallback(
    (id: string) => {
      const cur = editsRef.current;
      const next: MapEditsPayload = {
        ...cur,
        pois: (cur.pois ?? []).filter((p) => p.id !== id),
        deletedPoiIds: Array.from(new Set([...(cur.deletedPoiIds ?? []), id])),
      };
      persistEdits(next);
      setSelectedEntity((prev) => (prev?.type === 'poi' && prev.data.id === id ? null : prev));
    },
    [persistEdits]
  );

  const handleMovePoi = useCallback(
    (poiId: string, pos: WorldPoint) => {
      const cur = editsRef.current;
      const existing = (cur.pois ?? []).find((p) => p.id === poiId) ?? pois.find((p) => p.id === poiId);
      if (!existing) return;
      const updated: MapPoi = {
        ...existing,
        x: Math.round(pos.x),
        z: Math.round(pos.z),
        isUserEdited: true,
      };
      const next: MapEditsPayload = {
        ...cur,
        pois: [...(cur.pois ?? []).filter((p) => p.id !== poiId), updated],
      };
      persistEdits(next, false, false);
      setSelectedEntity({ type: 'poi', data: updated });
    },
    [persistEdits, pois]
  );

  const handleSavePlace = useCallback(
    (place: MapPlaceLabel) => {
      const cur = editsRef.current;
      const existing = cur.places ?? [];
      const filtered = existing.filter((p) => p.id !== place.id);
      const saved: MapPlaceLabel = { ...place, isUserEdited: true };
      const next: MapEditsPayload = {
        ...cur,
        places: [...filtered, saved],
        deletedPlaceIds: (cur.deletedPlaceIds ?? []).filter((id) => id !== place.id),
      };
      persistEdits(next);
      setSelectedEntity({ type: 'place', data: saved });
      setLastEditorNotice(`Надпись «${saved.name}» сохранена`);
    },
    [persistEdits]
  );

  const handleDeletePlace = useCallback(
    (id: string) => {
      const cur = editsRef.current;
      const next: MapEditsPayload = {
        ...cur,
        places: (cur.places ?? []).filter((p) => p.id !== id),
        deletedPlaceIds: Array.from(new Set([...(cur.deletedPlaceIds ?? []), id])),
      };
      persistEdits(next);
      setSelectedEntity((prev) => (prev?.type === 'place' && prev.data.id === id ? null : prev));
    },
    [persistEdits]
  );

  const handleMovePlace = useCallback(
    (placeId: string, pos: WorldPoint) => {
      const cur = editsRef.current;
      const existing =
        (cur.places ?? []).find((p) => p.id === placeId) ??
        mapPlaces.find((p) => p.id === placeId);
      if (!existing) return;
      const updated: MapPlaceLabel = {
        ...existing,
        x: Math.round(pos.x),
        z: Math.round(pos.z),
        isUserEdited: true,
      };
      const next: MapEditsPayload = {
        ...cur,
        places: [...(cur.places ?? []).filter((p) => p.id !== placeId), updated],
      };
      persistEdits(next, false, false);
      setSelectedEntity({ type: 'place', data: updated });
    },
    [persistEdits, mapPlaces]
  );

  const handleResetDefaultPlaces = useCallback(() => {
    const cur = editsRef.current;
    const next: MapEditsPayload = {
      ...cur,
      places: [],
      deletedPlaceIds: [],
    };
    persistEdits(next);
    setSelectedEntity((prev) => (prev?.type === 'place' ? null : prev));
  }, [persistEdits]);

  const handleSelectPlaceFromList = useCallback(
    (place: MapPlaceLabel) => {
      setSelectedEntity({ type: 'place', data: place });
      const targetZoom =
        place.tier === 'district'
          ? 0.22
          : place.tier === 'city'
          ? 0.042
          : place.tier === 'town'
          ? 0.058
          : 0.075;
      flyTo(place.x, place.z, targetZoom);
    },
    [flyTo]
  );

  const handleMapClickForEditor = useCallback(
    (pt: WorldPoint & { y?: number }) => {
      const snappedPt = { x: Math.round(pt.x), z: Math.round(pt.z) };
      if (editorTool === 'add-building') {
        setDraftBuildingCenter(snappedPt);
      } else if (editorTool === 'add-street') {
        const elevY = Math.round(pt.y ?? draftStreetElevationY);
        setDraftStreetPoints((prev) => [...prev, snappedPt]);
        setDraftStreetPoints3D((prev) => [...prev, { x: snappedPt.x, y: elevY, z: snappedPt.z }]);
      } else if (editorTool === 'add-land') {
        const landPt = {
          x: Math.round(pt.x * 10) / 10,
          z: Math.round(pt.z * 10) / 10,
        };
        setDraftLandPoints((prev) => [...prev, landPt]);
      } else if (editorTool === 'add-poi') {
        setDraftPoiCenter(snappedPt);
        const meta = POI_ICON_MAP[draftPoiIcon] ?? POI_ICON_MAP.star;
        const created: MapPoi = {
          id: `user-poi-${Date.now()}`,
          name: meta.shortLabel,
          icon: draftPoiIcon,
          x: snappedPt.x,
          z: snappedPt.z,
          isUserEdited: true,
        };
        handleSavePoi(created);
      } else if (editorTool === 'add-place') {
        setDraftPlaceCenter(snappedPt);
        const defaultName =
          draftPlaceTier === 'city'
            ? 'Новый город'
            : draftPlaceTier === 'town'
            ? 'Новый посёлок'
            : draftPlaceTier === 'village'
            ? 'Новая деревня'
            : 'Новый район';
        const created: MapPlaceLabel = {
          id: `user-place-${Date.now()}`,
          name: defaultName,
          x: snappedPt.x,
          z: snappedPt.z,
          tier: draftPlaceTier,
          priority: draftPlaceTier === 'city' ? 90 : draftPlaceTier === 'district' ? 80 : 65,
          isUserEdited: true,
        };
        handleSavePlace(created);
      }
    },
    [editorTool, draftStreetElevationY, draftPoiIcon, draftPlaceTier, handleSavePoi, handleSavePlace]
  );

  const handlePickRoutePoint = useCallback(
    (which: 'A' | 'B', pt: WorldPoint) => {
      const ep: RouteEndpoint = {
        label: `Точка (${Math.round(pt.x)}, ${Math.round(pt.z)})`,
        sublabel: 'Выбрано на карте',
        x: Math.round(pt.x),
        z: Math.round(pt.z),
      };
      if (which === 'A') {
        setPointA(ep);
        if (pointB) {
          frameRouteEndpoints(ep, pointB);
          setPickMode(null);
        } else {
          setPickMode('B');
        }
      } else {
        setPointB(ep);
        if (pointA) frameRouteEndpoints(pointA, ep);
        setPickMode(null);
      }
      setIsEditorMode(false);
      setActiveTab('route');
      setSidebarOpen(true);
      setMobileSheetSnap('compact');
    },
    [pointA, pointB, frameRouteEndpoints]
  );

  const handleSaveBuilding = useCallback(
    (building: Building3D) => {
      const cur = editsRef.current;
      const isUpdatingExisting = cur.buildings.some((b) => b.id === building.id);
      let finalBuilding = building;
      let renumberedExisting: Building3D[] = [];

      if (!isUpdatingExisting && autoHouseNumbering) {
        const autoRes = autoAddressNewBuilding(building, buildings, streets);
        finalBuilding = autoRes.created;
        renumberedExisting = autoRes.updatedExisting;
      }

      const bMap = new Map<string, Building3D>();
      for (const b of cur.buildings) {
        if (b.id !== finalBuilding.id) bMap.set(b.id, b);
      }
      for (const ub of renumberedExisting) {
        bMap.set(ub.id, ub);
      }
      bMap.set(finalBuilding.id, finalBuilding);

      const next: MapEditsPayload = {
        ...cur,
        buildings: Array.from(bMap.values()),
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => id !== finalBuilding.id),
      };
      persistEdits(next);
      setSelectedEntity({ type: 'building', data: finalBuilding });
      if (isUpdatingExisting || editorTool !== 'add-building') {
        setEditorTool('select');
      } else {
        const renumNote =
          renumberedExisting.length > 0 ? ` · обновлено номеров: ${renumberedExisting.length}` : '';
        setLastEditorNotice(
          `Здание «${finalBuilding.street}, д. ${finalBuilding.houseNumber}» добавлено${renumNote}`
        );
      }
    },
    [persistEdits, editorTool, autoHouseNumbering, buildings, streets]
  );

  const handleDeleteBuilding = useCallback(
    (id: string) => {
      const cur = editsRef.current;
      const next: MapEditsPayload = {
        ...cur,
        buildings: cur.buildings.filter((b) => b.id !== id),
        deletedBuildingIds: Array.from(new Set([...cur.deletedBuildingIds, id])),
      };
      setAutoBuildings((prev) => prev.filter((b) => b.id !== id));
      persistEdits(next);
      setSelectedEntity(null);
      setActiveWingId(null);
      setIsDrawingWing(false);
      setMergeSourceBuildingId(null);
    },
    [persistEdits]
  );

  // Rotate building (or active wing) cleanly
  const handleRotateBuilding = useCallback(
    (buildingId: string, angleDeg: number, wingId?: string) => {
      const target = buildings.find((b) => b.id === buildingId);
      if (!target) return;
      const rotated = rotateBuilding(target, angleDeg, wingId);
      const cur = editsRef.current;
      const filtered = cur.buildings.filter((b) => b.id !== rotated.id);
      persistEdits(
        {
          ...cur,
          buildings: [...filtered, { ...rotated, isUserEdited: true }],
          deletedBuildingIds: cur.deletedBuildingIds.filter((id) => id !== rotated.id),
        },
        false,
        true
      );
      setSelectedEntity({ type: 'building', data: rotated });
    },
    [buildings, persistEdits]
  );

  // Instantly attach an adjacent wing (корпус) under the same building address
  const handleAddWingQuick = useCallback(
    (buildingId: string) => {
      const target = buildings.find((b) => b.id === buildingId);
      if (!target) return;
      const { building: updated, newWingId } = addWingToBuilding(target);
      const cur = editsRef.current;
      const filtered = cur.buildings.filter((b) => b.id !== updated.id);
      persistEdits({
        ...cur,
        buildings: [...filtered, { ...updated, isUserEdited: true }],
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => id !== updated.id),
      });
      setSelectedEntity({ type: 'building', data: updated });
      setActiveWingId(newWingId);
      setLastEditorNotice(`Добавлен корпус (всего корпусов: ${getBuildingWings(updated).length})`);
    },
    [buildings, persistEdits]
  );

  // Attach a custom wing drawn by dragging a rectangle/shape on the map
  const handleAddWingFromArea = useCallback(
    (buildingId: string, rect: RoadSnappedBuildingRect) => {
      const target = buildings.find((b) => b.id === buildingId);
      if (!target) return;
      const activeShape = draftBuildingSize.shape ?? 'rect';
      const triCorner = draftBuildingSize.triangleCorner ?? 0;
      const skewDeg = draftBuildingSize.skewDeg ?? 25;
      const footprint =
        activeShape === 'triangle'
          ? createTriangleFootprint(rect.x, rect.z, rect.width, rect.depth, rect.angleDeg, triCorner)
          : activeShape === 'circle'
          ? createCircleFootprint(rect.x, rect.z, rect.width, rect.depth, rect.angleDeg, 20)
          : activeShape === 'parallelogram'
          ? createParallelogramFootprint(rect.x, rect.z, rect.width, rect.depth, rect.angleDeg, skewDeg)
          : rect.footprint;
      const shapeType =
        activeShape === 'triangle'
          ? ('triangular' as const)
          : activeShape === 'circle'
          ? ('circular' as const)
          : activeShape === 'parallelogram'
          ? ('parallelogram' as const)
          : ('rectangular' as const);
      const { building: updated, newWingId } = addWingToBuilding(target, {
        x: rect.x,
        z: rect.z,
        width: rect.width,
        depth: rect.depth,
        angleDeg: rect.angleDeg,
        floors: target.floors,
        height: target.height,
        shapeType,
        skewDeg: activeShape === 'parallelogram' ? skewDeg : undefined,
        footprint,
      });
      const cur = editsRef.current;
      const filtered = cur.buildings.filter((b) => b.id !== updated.id);
      persistEdits({
        ...cur,
        buildings: [...filtered, { ...updated, isUserEdited: true }],
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => id !== updated.id),
      });
      setSelectedEntity({ type: 'building', data: updated });
      setActiveWingId(newWingId);
      setIsDrawingWing(false);
      setLastEditorNotice(
        `Добавлен корпус ${rect.width}×${rect.depth} м (всего: ${getBuildingWings(updated).length})`
      );
    },
    [
      buildings,
      draftBuildingSize.shape,
      draftBuildingSize.skewDeg,
      draftBuildingSize.triangleCorner,
      persistEdits,
    ]
  );

  // Convert any existing building wing into an arbitrary editable freeform polygon
  const handleConvertWingToFreeform = useCallback(
    (buildingId: string, wingId?: string) => {
      const target = buildings.find((b) => b.id === buildingId);
      if (!target) return;
      const updated = convertWingToFreeform(target, wingId);
      const cur = editsRef.current;
      const filtered = cur.buildings.filter((b) => b.id !== updated.id);
      persistEdits({
        ...cur,
        buildings: [...filtered, { ...updated, isUserEdited: true }],
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => id !== updated.id),
      });
      setSelectedEntity({ type: 'building', data: updated });
      setLastEditorNotice(
        'Режим лепки формы: тяните белые вершины, тяните «+» на гранях для новых узлов, Alt+клик — удалить узел'
      );
    },
    [buildings, persistEdits]
  );

  const handleAddBuildingPolygonPoint = useCallback((pt: WorldPoint) => {
    const snapped = { x: Math.round(pt.x * 2) / 2, z: Math.round(pt.z * 2) / 2 };
    setDraftBuildingPolygon((prev) => [...prev, snapped]);
  }, []);

  const handlePopBuildingPolygonPoint = useCallback(() => {
    setDraftBuildingPolygon((prev) => prev.slice(0, -1));
  }, []);

  const handleClearBuildingPolygon = useCallback(() => {
    setDraftBuildingPolygon([]);
  }, []);

  const handleFinishBuildingPolygon = useCallback(() => {
    if (draftBuildingPolygon.length < 3) return;
    const cwPoly = ensureClockwiseFootprint(draftBuildingPolygon);
    const { x: cx, z: cz, width, depth } = computePolygonCentroidAndDims(cwPoly);

    // Case 1: Attaching a freeform wing to an existing selected building
    if (isDrawingWing && selectedEntity?.type === 'building') {
      const target =
        buildings.find((b) => b.id === selectedEntity.data.id) ?? selectedEntity.data;
      const { building: updated, newWingId } = addWingToBuilding(target, {
        x: cx,
        z: cz,
        width,
        depth,
        angleDeg: 0,
        floors: target.floors,
        height: target.height,
        shapeType: 'freeform',
        footprint: cwPoly,
      });
      const cur = editsRef.current;
      const filtered = cur.buildings.filter((b) => b.id !== updated.id);
      persistEdits({
        ...cur,
        buildings: [...filtered, { ...updated, isUserEdited: true }],
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => id !== updated.id),
      });
      setSelectedEntity({ type: 'building', data: updated });
      setActiveWingId(newWingId);
      setIsDrawingWing(false);
      setDraftBuildingPolygon([]);
      setLastEditorNotice(
        `Пристроен произвольный корпус (${cwPoly.length} вершин · всего корпусов: ${getBuildingWings(updated).length})`
      );
      return;
    }

    // Case 2: Creating a brand-new arbitrary freeform building
    const cur = editsRef.current;
    const floors = Math.max(1, draftBuildingSize.floors);
    const height = Math.round(floors * 4.2 + 3);
    const district = inferDistrict(cx, cz);
    const rawCreated: Building3D = {
      id: `user-poly-b-${Date.now()}`,
      name: `Здание произвольной формы (${cwPoly.length} верш.)`,
      street: district,
      houseNumber: String(buildings.length + 1),
      district,
      category: 'residential',
      x: cx,
      z: cz,
      footprint: cwPoly,
      shapeType: 'freeform',
      measuredWidth: width,
      measuredDepth: depth,
      orientationDeg: 0,
      floors,
      height,
      baseY: SERVER_GROUND_Y,
      roofY: SERVER_GROUND_Y + height,
      roofType: 'flat',
      isUserEdited: true,
    };

    let created = rawCreated;
    let updatedExisting: Building3D[] = [];
    if (autoHouseNumbering) {
      const autoRes = autoAddressNewBuilding(rawCreated, buildings, streets);
      created = autoRes.created;
      updatedExisting = autoRes.updatedExisting;
    }

    const bMap = new Map(cur.buildings.map((b) => [b.id, b]));
    for (const ub of updatedExisting) bMap.set(ub.id, ub);
    bMap.set(created.id, created);

    persistEdits(
      {
        ...cur,
        buildings: Array.from(bMap.values()),
      },
      true
    );
    setSelectedEntity({ type: 'building', data: created });
    setDraftBuildingPolygon([]);
    const renumSuffix =
      updatedExisting.length > 0 ? ` · обновлено номеров: ${updatedExisting.length}` : '';
    setLastEditorNotice(
      `Создано здание (${created.street}, д. ${created.houseNumber}${renumSuffix})`
    );
  }, [
    autoHouseNumbering,
    buildings,
    streets,
    draftBuildingPolygon,
    draftBuildingSize.floors,
    isDrawingWing,
    persistEdits,
    selectedEntity,
  ]);

  // Delete a specific wing (корпус) from a complex building
  const handleRemoveWing = useCallback(
    (buildingId: string, wingId: string) => {
      const target = buildings.find((b) => b.id === buildingId);
      if (!target) return;
      const res = removeWingFromBuilding(target, wingId);
      if (!res.removed) return;
      const cur = editsRef.current;
      const filtered = cur.buildings.filter((b) => b.id !== res.building.id);
      persistEdits({
        ...cur,
        buildings: [...filtered, { ...res.building, isUserEdited: true }],
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => id !== res.building.id),
      });
      setSelectedEntity({ type: 'building', data: res.building });
      setActiveWingId(res.nextActiveWingId);
      setLastEditorNotice(
        `Корпус удалён (осталось: ${getBuildingWings(res.building).length})`
      );
    },
    [buildings, persistEdits]
  );

  // Merge two buildings under a single unified address (used by Merge tool AND quick Shift + ЛКМ)
  const handleQuickMergeBuildings = useCallback(
    (sourceBuildingId: string, targetBuildingId: string) => {
      if (!sourceBuildingId || sourceBuildingId === targetBuildingId) {
        setMergeSourceBuildingId(null);
        return;
      }
      const primary = buildings.find((b) => b.id === sourceBuildingId);
      const secondary = buildings.find((b) => b.id === targetBuildingId);
      if (!primary || !secondary) {
        setMergeSourceBuildingId(null);
        return;
      }
      const merged = mergeBuildings(primary, secondary);
      const cur = editsRef.current;
      const filtered = cur.buildings.filter(
        (b) => b.id !== primary.id && b.id !== secondary.id
      );
      setAutoBuildings((prev) => prev.filter((b) => b.id !== secondary.id));
      persistEdits({
        ...cur,
        buildings: [...filtered, { ...merged, isUserEdited: true }],
        deletedBuildingIds: Array.from(
          new Set([
            ...cur.deletedBuildingIds.filter((id) => id !== primary.id),
            secondary.id,
          ])
        ),
      });
      setSelectedEntity({ type: 'building', data: merged });
      const wings = getBuildingWings(merged);
      setActiveWingId(wings[wings.length - 1]?.id ?? null);
      setMergeSourceBuildingId(null);
      setLastEditorNotice(
        `Здания объединены под адресом «${merged.street}, д. ${merged.houseNumber}» (${wings.length} корп.)`
      );
    },
    [buildings, persistEdits]
  );

  const handleCompleteMergeBuilding = useCallback(
    (targetBuildingId: string) => {
      if (!mergeSourceBuildingId) return;
      handleQuickMergeBuildings(mergeSourceBuildingId, targetBuildingId);
    },
    [mergeSourceBuildingId, handleQuickMergeBuildings]
  );

  // Split complex building wings into independent buildings OR bisect a single rectangular building
  const handleSplitBuilding = useCallback(
    (buildingId: string) => {
      const target = buildings.find((b) => b.id === buildingId);
      if (!target) return;
      const parts = splitBuilding(target);
      if (parts.length < 2) return;
      const cur = editsRef.current;
      const filtered = cur.buildings.filter((b) => b.id !== target.id);
      persistEdits({
        ...cur,
        buildings: [...filtered, ...parts.map((p) => ({ ...p, isUserEdited: true }))],
        deletedBuildingIds: cur.deletedBuildingIds.filter(
          (id) => !parts.some((p) => p.id === id)
        ),
      });
      setSelectedEntity({ type: 'building', data: parts[0] });
      setActiveWingId(getBuildingWings(parts[0])[0]?.id ?? null);
      setIsDrawingWing(false);
      setMergeSourceBuildingId(null);
      setLastEditorNotice(`Здание разделено на ${parts.length} отдельных строения`);
    },
    [buildings, persistEdits]
  );

  const resolveEntityFromMultiItem = useCallback(
    (item: MultiSelectedItem): SelectedEntity | null => {
      if (item.type === 'building') {
        const b = buildings.find((x) => x.id === item.id);
        return b ? { type: 'building', data: b } : null;
      }
      if (item.type === 'street') {
        const s = streets.find((x) => x.id === item.id);
        return s ? { type: 'street', data: s } : null;
      }
      if (item.type === 'land') {
        const f = landFeatures.find((x) => x.id === item.id);
        return f ? { type: 'land', data: f } : null;
      }
      if (item.type === 'poi') {
        const p = pois.find((x) => x.id === item.id);
        return p ? { type: 'poi', data: p } : null;
      }
      if (item.type === 'place') {
        const pl = mapPlaces.find((x) => x.id === item.id);
        return pl ? { type: 'place', data: pl } : null;
      }
      return null;
    },
    [buildings, streets, landFeatures, pois, mapPlaces]
  );

  // Universal multi-selection on Shift + LMB (buildings, streets, land features, POIs, places)
  const handleToggleMultiSelectEntity = useCallback(
    (clicked: MultiSelectedItem) => {
      setMergeSourceBuildingId(null);
      setIsDrawingWing(false);
      setMultiSelectedItems((prev) => {
        let base = prev;
        if (base.length === 0 && selectedEntity) {
          if (
            selectedEntity.type === 'building' ||
            selectedEntity.type === 'street' ||
            selectedEntity.type === 'land' ||
            selectedEntity.type === 'poi' ||
            selectedEntity.type === 'place'
          ) {
            const curItem: MultiSelectedItem = {
              type: selectedEntity.type,
              id: selectedEntity.data.id,
            };
            if (!(curItem.type === clicked.type && curItem.id === clicked.id)) {
              base = [curItem];
            }
          }
        }
        const exists = base.some((it) => it.type === clicked.type && it.id === clicked.id);
        const next = exists
          ? base.filter((it) => !(it.type === clicked.type && it.id === clicked.id))
          : [...base, clicked];

        if (next.length === 0) {
          setSelectedEntity(null);
          setLastEditorNotice(null);
        } else if (next.length === 1) {
          const single = resolveEntityFromMultiItem(next[0]);
          if (single) setSelectedEntity(single);
          setLastEditorNotice('Выделен 1 объект · Удерживайте Shift + ЛКМ или тяните рамку для добавления');
        } else {
          const bCount = next.filter((it) => it.type === 'building').length;
          setLastEditorNotice(
            `Выделено объектов: ${next.length}${
              bCount >= 2 ? ' · Enter — объединить здания' : ''
            } · Delete — удалить · Esc — сброс`
          );
        }
        return next;
      });
    },
    [selectedEntity, resolveEntityFromMultiItem]
  );

  const handleAddMultiSelectEntities = useCallback(
    (incoming: MultiSelectedItem[]) => {
      if (incoming.length === 0) return;
      setMergeSourceBuildingId(null);
      setIsDrawingWing(false);
      setMultiSelectedItems((prev) => {
        let base = prev;
        if (base.length === 0 && selectedEntity) {
          if (
            selectedEntity.type === 'building' ||
            selectedEntity.type === 'street' ||
            selectedEntity.type === 'land' ||
            selectedEntity.type === 'poi' ||
            selectedEntity.type === 'place'
          ) {
            base = [{ type: selectedEntity.type, id: selectedEntity.data.id }];
          }
        }
        const seen = new Set(base.map((it) => `${it.type}:${it.id}`));
        const next = [...base];
        for (const item of incoming) {
          const key = `${item.type}:${item.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            next.push(item);
          }
        }
        if (next.length === 1) {
          const single = resolveEntityFromMultiItem(next[0]);
          if (single) setSelectedEntity(single);
        }
        if (next.length >= 2) {
          const bCount = next.filter((it) => it.type === 'building').length;
          setLastEditorNotice(
            `Выделено рамкой: всего ${next.length} об.${
              bCount >= 2 ? ' · Enter — объединить здания' : ''
            }`
          );
        }
        return next;
      });
    },
    [selectedEntity, resolveEntityFromMultiItem]
  );

  const handleRemoveMultiSelectKind = useCallback(
    (kind: MultiSelectKind) => {
      setMultiSelectedItems((prev) => {
        const next = prev.filter((it) => it.type !== kind);
        if (next.length === 0) {
          setSelectedEntity(null);
          setLastEditorNotice(null);
        } else if (next.length === 1) {
          const single = resolveEntityFromMultiItem(next[0]);
          if (single) setSelectedEntity(single);
        }
        return next;
      });
    },
    [resolveEntityFromMultiItem]
  );

  const handleToggleMultiSelectBuilding = useCallback(
    (clickedBuildingId: string) => {
      handleToggleMultiSelectEntity({ type: 'building', id: clickedBuildingId });
    },
    [handleToggleMultiSelectEntity]
  );

  const handleMergeMultiSelectedBuildings = useCallback(() => {
    if (multiSelectedBuildingIds.length < 2) return;
    const toMerge = multiSelectedBuildingIds
      .map((id) => buildings.find((b) => b.id === id))
      .filter((b): b is Building3D => Boolean(b));
    if (toMerge.length < 2) {
      setMultiSelectedItems((prev) => prev.filter((it) => it.type !== 'building'));
      return;
    }
    const merged = mergeMultipleBuildings(toMerge);
    const absorbedIds = toMerge.slice(1).map((b) => b.id);
    const absorbedSet = new Set(absorbedIds);
    const cur = editsRef.current;
    const filtered = cur.buildings.filter(
      (b) => b.id !== merged.id && !absorbedSet.has(b.id)
    );
    setAutoBuildings((prev) => prev.filter((b) => !absorbedSet.has(b.id)));
    persistEdits({
      ...cur,
      buildings: [...filtered, { ...merged, isUserEdited: true }],
      deletedBuildingIds: Array.from(
        new Set([
          ...cur.deletedBuildingIds.filter((id) => id !== merged.id),
          ...absorbedIds,
        ])
      ),
    });
    setSelectedEntity({ type: 'building', data: merged });
    const wings = getBuildingWings(merged);
    setActiveWingId(wings[wings.length - 1]?.id ?? null);
    setMultiSelectedItems((prev) => prev.filter((it) => it.type !== 'building'));
    setLastEditorNotice(
      `Объединено ${toMerge.length} зданий в единый адрес «${merged.street}, д. ${merged.houseNumber}» (${wings.length} корп.)`
    );
  }, [multiSelectedBuildingIds, buildings, persistEdits]);

  const handleBatchDeleteMultiSelected = useCallback(() => {
    if (multiSelectedItems.length === 0) return;
    const bIds = new Set(multiSelectedItems.filter((it) => it.type === 'building').map((it) => it.id));
    const sIds = new Set(multiSelectedItems.filter((it) => it.type === 'street').map((it) => it.id));
    const lIds = new Set(multiSelectedItems.filter((it) => it.type === 'land').map((it) => it.id));
    const pIds = new Set(multiSelectedItems.filter((it) => it.type === 'poi').map((it) => it.id));
    const plIds = new Set(multiSelectedItems.filter((it) => it.type === 'place').map((it) => it.id));

    if (bIds.size > 0) setAutoBuildings((prev) => prev.filter((b) => !bIds.has(b.id)));
    if (sIds.size > 0) setAutoStreets((prev) => prev.filter((s) => !sIds.has(s.id)));

    const cur = editsRef.current;
    persistEdits({
      ...cur,
      buildings: cur.buildings.filter((b) => !bIds.has(b.id)),
      deletedBuildingIds: Array.from(new Set([...cur.deletedBuildingIds, ...bIds])),
      streets: cur.streets.filter((s) => !sIds.has(s.id)),
      deletedStreetIds: Array.from(new Set([...cur.deletedStreetIds, ...sIds])),
      landFeatures: (cur.landFeatures ?? []).filter((f) => !lIds.has(f.id)),
      deletedLandIds: Array.from(new Set([...(cur.deletedLandIds ?? []), ...lIds])),
      pois: (cur.pois ?? []).filter((p) => !pIds.has(p.id)),
      deletedPoiIds: Array.from(new Set([...(cur.deletedPoiIds ?? []), ...pIds])),
      places: (cur.places ?? []).filter((pl) => !plIds.has(pl.id)),
      deletedPlaceIds: Array.from(new Set([...(cur.deletedPlaceIds ?? []), ...plIds])),
    });
    const total = multiSelectedItems.length;
    setMultiSelectedItems([]);
    setSelectedEntity(null);
    setLastEditorNotice(`Удалено объектов: ${total} (Ctrl+Z для отмены)`);
  }, [multiSelectedItems, persistEdits]);

  const handleBatchUpdateBuildings = useCallback(
    (patch: {
      name?: string;
      category?: BuildingCategory;
      floors?: number;
      baseYDelta?: number;
      street?: string;
      district?: string;
      icon?: PoiIconKind | '';
      roofType?: RoofType;
    }) => {
      const targetIds = new Set(
        multiSelectedItems.filter((it) => it.type === 'building').map((it) => it.id)
      );
      if (targetIds.size === 0) return;
      const cur = editsRef.current;
      const bMap = new Map(cur.buildings.map((b) => [b.id, b]));
      let updatedCount = 0;
      for (const b of buildings) {
        if (!targetIds.has(b.id)) continue;
        const nextFloors = patch.floors ?? b.floors;
        const nextHeight = patch.floors ? Math.max(3, Math.round(patch.floors * 3.4)) : b.height;
        const nextBaseY =
          patch.baseYDelta !== undefined
            ? Math.max(
                SERVER_GROUND_Y - 24,
                Math.min(SERVER_GROUND_Y + 80, Math.round((b.baseY ?? SERVER_GROUND_Y) + patch.baseYDelta))
              )
            : b.baseY;
        const nextWings = b.wings?.map((w) => ({
          ...w,
          floors: patch.floors ?? w.floors,
          height: patch.floors ? Math.max(3, Math.round(patch.floors * 3.4)) : w.height,
          baseY:
            patch.baseYDelta !== undefined
              ? Math.max(
                  SERVER_GROUND_Y - 24,
                  Math.min(
                    SERVER_GROUND_Y + 80,
                    Math.round((w.baseY ?? b.baseY ?? SERVER_GROUND_Y) + patch.baseYDelta)
                  )
                )
              : w.baseY,
          roofType: patch.roofType ?? w.roofType,
        }));
        bMap.set(b.id, {
          ...b,
          name: patch.name ?? b.name,
          category: patch.category ?? b.category,
          floors: nextFloors,
          height: nextHeight,
          baseY: nextBaseY,
          street: patch.street ?? b.street,
          district: patch.district ?? b.district,
          roofType: patch.roofType ?? b.roofType,
          icon: patch.icon === '' ? undefined : patch.icon ?? b.icon,
          wings: nextWings,
          isUserEdited: true,
        });
        updatedCount++;
      }
      if (updatedCount === 0) return;
      persistEdits({
        ...cur,
        buildings: Array.from(bMap.values()),
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => !targetIds.has(id)),
      });
      setLastEditorNotice(`Обновлено зданий: ${updatedCount}`);
    },
    [multiSelectedItems, buildings, persistEdits]
  );

  const handleBatchUpdateStreets = useCallback(
    (patch: {
      name?: string;
      roadClass?: RoadClass;
      width?: number;
      oneWay?: OneWayDirection;
      reverseDirection?: boolean;
      elevationY?: number;
      elevationDelta?: number;
      district?: string;
      simAllowed?: boolean;
    }) => {
      const targetIds = new Set(
        multiSelectedItems.filter((it) => it.type === 'street').map((it) => it.id)
      );
      if (targetIds.size === 0) return;
      const cur = editsRef.current;
      const sMap = new Map(cur.streets.map((s) => [s.id, s]));
      let updatedCount = 0;
      for (const s of streets) {
        if (!targetIds.has(s.id)) continue;
        const nextClass = patch.roadClass ?? s.roadClass;
        const oldElev = Math.round(s.elevationY ?? SERVER_GROUND_Y);
        const nextElev =
          patch.elevationY !== undefined
            ? Math.round(patch.elevationY)
            : patch.elevationDelta !== undefined
            ? Math.max(SERVER_GROUND_Y - 30, Math.min(SERVER_GROUND_Y + 60, oldElev + patch.elevationDelta))
            : oldElev;
        const deltaY = nextElev - oldElev;
        const nextPoints3D =
          s.points3D && deltaY !== 0
            ? s.points3D.map((p) => ({ ...p, y: p.y + deltaY }))
            : s.points3D;
        let nextOneWay: OneWayDirection = patch.oneWay ?? s.oneWay ?? 'none';
        if (patch.reverseDirection && nextOneWay !== 'none') {
          nextOneWay = nextOneWay === 'forward' ? 'reverse' : 'forward';
        }
        if (nextClass === 'pedestrian' || nextClass === 'railway') {
          nextOneWay = 'none';
        }
        sMap.set(s.id, {
          ...s,
          name: patch.name ?? s.name,
          roadClass: nextClass,
          width: patch.width ?? s.width,
          oneWay: nextOneWay,
          elevationY: nextElev,
          points3D: nextPoints3D,
          district: patch.district ?? s.district,
          simAllowed:
            nextClass === 'pedestrian' || nextClass === 'railway'
              ? false
              : patch.simAllowed ?? s.simAllowed,
          isUserEdited: true,
        });
        updatedCount++;
      }
      if (updatedCount === 0) return;
      persistEdits({
        ...cur,
        streets: Array.from(sMap.values()),
        deletedStreetIds: cur.deletedStreetIds.filter((id) => !targetIds.has(id)),
      });
      setLastEditorNotice(`Обновлено дорог: ${updatedCount}`);
    },
    [multiSelectedItems, streets, persistEdits]
  );

  const handleBatchUpdateLandFeatures = useCallback(
    (patch: { kind?: 'park' | 'water' | 'square'; name?: string }) => {
      const targetIds = new Set(
        multiSelectedItems.filter((it) => it.type === 'land').map((it) => it.id)
      );
      if (targetIds.size === 0) return;
      if (!patch.kind && patch.name === undefined) return;
      const cur = editsRef.current;
      const lMap = new Map((cur.landFeatures ?? []).map((f) => [f.id, f]));
      let updatedCount = 0;
      for (const f of landFeatures) {
        if (!targetIds.has(f.id)) continue;
        lMap.set(f.id, {
          ...f,
          kind: patch.kind ?? f.kind,
          name: patch.name !== undefined ? patch.name : f.name,
          isUserEdited: true,
        });
        updatedCount++;
      }
      if (updatedCount === 0) return;
      persistEdits({
        ...cur,
        landFeatures: Array.from(lMap.values()),
        deletedLandIds: (cur.deletedLandIds ?? []).filter((id) => !targetIds.has(id)),
      });
      setLastEditorNotice(`Обновлено территорий: ${updatedCount}`);
    },
    [multiSelectedItems, landFeatures, persistEdits]
  );

  const handleBatchUpdatePois = useCallback(
    (patch: { icon?: PoiIconKind; color?: string; description?: string }) => {
      const targetIds = new Set(
        multiSelectedItems.filter((it) => it.type === 'poi').map((it) => it.id)
      );
      if (targetIds.size === 0) return;
      const cur = editsRef.current;
      const pMap = new Map((cur.pois ?? []).map((p) => [p.id, p]));
      let updatedCount = 0;
      for (const p of pois) {
        if (!targetIds.has(p.id)) continue;
        pMap.set(p.id, {
          ...p,
          icon: patch.icon ?? p.icon,
          color: patch.color !== undefined ? patch.color || undefined : p.color,
          description:
            patch.description !== undefined ? patch.description || undefined : p.description,
          isUserEdited: true,
        });
        updatedCount++;
      }
      if (updatedCount === 0) return;
      persistEdits({
        ...cur,
        pois: Array.from(pMap.values()),
        deletedPoiIds: (cur.deletedPoiIds ?? []).filter((id) => !targetIds.has(id)),
      });
      setLastEditorNotice(`Обновлено меток: ${updatedCount}`);
    },
    [multiSelectedItems, pois, persistEdits]
  );

  const handleBatchUpdatePlaces = useCallback(
    (patch: { tier?: SettlementTier; priority?: number; subtitle?: string }) => {
      const targetIds = new Set(
        multiSelectedItems.filter((it) => it.type === 'place').map((it) => it.id)
      );
      if (targetIds.size === 0) return;
      const cur = editsRef.current;
      const plMap = new Map((cur.places ?? []).map((pl) => [pl.id, pl]));
      let updatedCount = 0;
      for (const pl of mapPlaces) {
        if (!targetIds.has(pl.id)) continue;
        plMap.set(pl.id, {
          ...pl,
          tier: patch.tier ?? pl.tier,
          priority: patch.priority !== undefined ? patch.priority : pl.priority,
          subtitle: patch.subtitle !== undefined ? patch.subtitle || undefined : pl.subtitle,
          isUserEdited: true,
        });
        updatedCount++;
      }
      if (updatedCount === 0) return;
      persistEdits({
        ...cur,
        places: Array.from(plMap.values()),
        deletedPlaceIds: (cur.deletedPlaceIds ?? []).filter((id) => !targetIds.has(id)),
      });
      setLastEditorNotice(`Обновлено подписей мест: ${updatedCount}`);
    },
    [multiSelectedItems, mapPlaces, persistEdits]
  );

  const handleSaveStreet = useCallback(
    (street: StreetSegment) => {
      const cur = editsRef.current;
      const prevStreet = streets.find((s) => s.id === street.id);
      const isUpdatingExisting = cur.streets.some((s) => s.id === street.id);
      const otherStreets = streets.filter((s) => s.id !== street.id);
      const integrated = integrateStreetWithAutoIntersections(street, otherStreets);
      const updatedMap = new Map<string, StreetSegment>();
      for (const s of cur.streets) {
        if (s.id !== street.id) updatedMap.set(s.id, s);
      }
      for (const u of integrated.updatedExistingStreets) {
        updatedMap.set(u.id, { ...u, isUserEdited: true });
      }
      const savedStreet: StreetSegment = { ...integrated.street, isUserEdited: true };
      updatedMap.set(savedStreet.id, savedStreet);
      const nextUserStreets = Array.from(updatedMap.values());

      // Compute full effective street list (merged user + auto) for accurate multi-segment numbering
      const mergedStreetsMap = new Map<string, StreetSegment>();
      for (const s of streets) mergedStreetsMap.set(s.id, s);
      for (const s of nextUserStreets) mergedStreetsMap.set(s.id, s);
      const effectiveNextStreets = Array.from(mergedStreetsMap.values());

      let nextBuildingsList = cur.buildings;
      let autoNumberedCount = 0;
      if (autoHouseNumbering && buildings.length > 0) {
        const numRes = autoAddressBuildingsForStreet(
          savedStreet,
          buildings,
          effectiveNextStreets,
          { previousStreetName: prevStreet?.name }
        );
        if (numRes.updatedBuildings.length > 0) {
          const bMap = new Map(cur.buildings.map((b) => [b.id, b]));
          for (const ub of numRes.updatedBuildings) bMap.set(ub.id, ub);
          nextBuildingsList = Array.from(bMap.values());
          autoNumberedCount = numRes.affectedCount;
        }
      }

      const next: MapEditsPayload = {
        ...cur,
        buildings: nextBuildingsList,
        streets: nextUserStreets,
        deletedStreetIds: cur.deletedStreetIds.filter((id) => id !== savedStreet.id),
      };
      persistEdits(next);
      setSelectedEntity({ type: 'street', data: savedStreet });
      const jCount = integrated.intersections.length;
      const jSuffix = jCount > 0 ? ` · автоперекрёстков: ${jCount}` : '';
      const numSuffix = autoNumberedCount > 0 ? ` · пронумеровано домов: ${autoNumberedCount}` : '';
      if (isUpdatingExisting || editorTool !== 'add-street') {
        setEditorTool('select');
        if (jCount > 0 || autoNumberedCount > 0) {
          setLastEditorNotice(`Дорога обновлена${jSuffix}${numSuffix}`);
        }
      } else {
        setDraftStreetPoints([]);
        setDraftStreetPoints3D([]);
        setLastEditorNotice(
          `Дорога «${savedStreet.name}» добавлена${jSuffix}${numSuffix} — рисуйте следующую`
        );
      }
    },
    [persistEdits, editorTool, streets, buildings, autoHouseNumbering]
  );

  const handleRenumberStreetBuildings = useCallback(
    (streetId: string) => {
      const target = streets.find((s) => s.id === streetId);
      if (!target) return;
      const numRes = autoAddressBuildingsForStreet(target, buildings, streets);
      if (numRes.updatedBuildings.length === 0) {
        setLastEditorNotice(`Нумерация по «${target.name}» уже актуальна`);
        return;
      }
      const cur = editsRef.current;
      const bMap = new Map(cur.buildings.map((b) => [b.id, b]));
      for (const ub of numRes.updatedBuildings) bMap.set(ub.id, ub);
      persistEdits({
        ...cur,
        buildings: Array.from(bMap.values()),
      });
      setLastEditorNotice(
        `Обновлена нумерация по «${target.name}»: ${numRes.affectedCount} д.`
      );
    },
    [streets, buildings, persistEdits]
  );

  const handleDeleteStreet = useCallback(
    (id: string) => {
      const cur = editsRef.current;
      const next: MapEditsPayload = {
        ...cur,
        streets: cur.streets.filter((s) => s.id !== id),
        deletedStreetIds: Array.from(new Set([...cur.deletedStreetIds, id])),
      };
      setAutoStreets((prev) => prev.filter((s) => s.id !== id));
      persistEdits(next);
      setSelectedEntity(null);
    },
    [persistEdits]
  );

  const handleSaveLandFeature = useCallback(
    (feature: LandFeature) => {
      const cur = editsRef.current;
      const existing = cur.landFeatures ?? [];
      const isUpdatingExisting = existing.some((f) => f.id === feature.id);
      const filtered = existing.filter((f) => f.id !== feature.id);
      const next: MapEditsPayload = {
        ...cur,
        landFeatures: [...filtered, { ...feature, isUserEdited: true }],
        deletedLandIds: (cur.deletedLandIds ?? []).filter((id) => id !== feature.id),
      };
      persistEdits(next);
      setSelectedEntity({ type: 'land', data: feature });
      if (isUpdatingExisting || editorTool !== 'add-land') {
        setEditorTool('select');
      } else {
        setDraftLandPoints([]);
        setLastEditorNotice(`Территория «${feature.name}» добавлена — рисуйте следующую`);
      }
    },
    [persistEdits, editorTool]
  );

  const handleDeleteLandFeature = useCallback(
    (id: string) => {
      const cur = editsRef.current;
      const next: MapEditsPayload = {
        ...cur,
        landFeatures: (cur.landFeatures ?? []).filter((f) => f.id !== id),
        deletedLandIds: Array.from(new Set([...(cur.deletedLandIds ?? []), id])),
      };
      persistEdits(next);
      setSelectedEntity(null);
    },
    [persistEdits]
  );

  // Direct live mouse resizing for selected building (corners or height handle)
  const handleResizeBuilding = useCallback(
    (updated: Building3D) => {
      const cur = editsRef.current;
      const filtered = cur.buildings.filter((b) => b.id !== updated.id);
      const next: MapEditsPayload = {
        ...cur,
        buildings: [...filtered, { ...updated, isUserEdited: true }],
        deletedBuildingIds: cur.deletedBuildingIds.filter((id) => id !== updated.id),
      };
      persistEdits(next, false, false);
      setSelectedEntity({ type: 'building', data: updated });
    },
    [persistEdits]
  );

  // Direct live mouse resizing / vertex moving for selected street
  const handleResizeStreet = useCallback(
    (updated: StreetSegment) => {
      const cur = editsRef.current;
      const filtered = cur.streets.filter((s) => s.id !== updated.id);
      const next: MapEditsPayload = {
        ...cur,
        streets: [...filtered, { ...updated, isUserEdited: true }],
        deletedStreetIds: cur.deletedStreetIds.filter((id) => id !== updated.id),
      };
      persistEdits(next, false, false);
      setSelectedEntity({ type: 'street', data: updated });
    },
    [persistEdits]
  );

  // Direct live vertex moving for selected park/water polygon
  const handleResizeLandFeature = useCallback(
    (updated: LandFeature) => {
      const cur = editsRef.current;
      const existing = cur.landFeatures ?? [];
      const filtered = existing.filter((f) => f.id !== updated.id);
      const next: MapEditsPayload = {
        ...cur,
        landFeatures: [...filtered, { ...updated, isUserEdited: true }],
        deletedLandIds: (cur.deletedLandIds ?? []).filter((id) => id !== updated.id),
      };
      persistEdits(next, false, false);
      setSelectedEntity({ type: 'land', data: updated });
    },
    [persistEdits]
  );

  // Direct live drag or coordinate edit for a transit station/stop (preserves all routes & schedules)
  const handleMoveStation = useCallback(
    (stationId: string, pos: WorldPoint) => {
      const cur = editsRef.current;
      const prevOv = cur.stationOverrides?.[stationId];
      const orig = rawStations.find((s) => s.id === stationId);
      const nextOv = {
        x: Math.round(pos.x),
        z: Math.round(pos.z),
        y: prevOv?.y ?? orig?.y,
        name: prevOv?.name ?? orig?.name,
      };
      const next: MapEditsPayload = {
        ...cur,
        stationOverrides: {
          ...(cur.stationOverrides ?? {}),
          [stationId]: nextOv,
        },
      };
      persistEdits(next, false, false);
      if (orig) {
        setSelectedEntity({
          type: 'station',
          data: { ...orig, x: nextOv.x, z: nextOv.z, y: nextOv.y ?? orig.y, name: nextOv.name ?? orig.name },
        });
      }
    },
    [persistEdits, rawStations]
  );

  const handleUpdateStationOverride = useCallback(
    (stationId: string, override: { x: number; z: number; y?: number; name?: string }) => {
      const cur = editsRef.current;
      const next: MapEditsPayload = {
        ...cur,
        stationOverrides: {
          ...(cur.stationOverrides ?? {}),
          [stationId]: override,
        },
      };
      persistEdits(next, true, true);
      const orig = rawStations.find((s) => s.id === stationId);
      if (orig) {
        setSelectedEntity({
          type: 'station',
          data: {
            ...orig,
            x: override.x,
            z: override.z,
            y: override.y ?? orig.y,
            name: override.name ?? orig.name,
          },
        });
      }
    },
    [persistEdits, rawStations]
  );

  const handleResetStationOverride = useCallback(
    (stationId: string) => {
      const cur = editsRef.current;
      const nextOverrides = { ...(cur.stationOverrides ?? {}) };
      delete nextOverrides[stationId];
      persistEdits({ ...cur, stationOverrides: nextOverrides }, true, true);
      const orig = rawStations.find((s) => s.id === stationId);
      if (orig) setSelectedEntity({ type: 'station', data: orig });
    },
    [persistEdits, rawStations]
  );

  // Direct live vertex drag / insertion on a transit route line (preserves all route metadata & vehicles)
  const handleUpdateRoutePath = useCallback(
    (routeId: string, points: WorldPoint[], points3D?: WorldPoint3D[]) => {
      const cur = editsRef.current;
      const next: MapEditsPayload = {
        ...cur,
        routeOverrides: {
          ...(cur.routeOverrides ?? {}),
          [routeId]: { points, points3D },
        },
      };
      persistEdits(next, false, false);
      const baseRt = routes.find((r) => r.id === routeId);
      if (baseRt) {
        setSelectedEntity({
          type: 'route',
          data: { ...baseRt, tracedPath: points, tracedPath3D: points3D ?? baseRt.tracedPath3D },
        });
      }
    },
    [persistEdits, routes]
  );

  const handleResetRouteOverride = useCallback(
    (routeId: string) => {
      const cur = editsRef.current;
      const nextOverrides = { ...(cur.routeOverrides ?? {}) };
      delete nextOverrides[routeId];
      persistEdits({ ...cur, routeOverrides: nextOverrides }, true, true);
      const orig = rawRoutesWithStationMoves.find((r) => r.id === routeId);
      if (orig) setSelectedEntity({ type: 'route', data: orig });
    },
    [persistEdits, rawRoutesWithStationMoves]
  );

  // Literal area-drag building creation with automatic road & building snapping + auto house numbering
  const handleCreateBuildingFromArea = useCallback(
    (rect: RoadSnappedBuildingRect) => {
      const cur = editsRef.current;
      const floors = Math.max(1, draftBuildingSize.floors);
      const height = Math.round(floors * 4.2 + 3);
      const streetName = rect.snappedStreetName || 'Новая улица';
      const district = rect.snappedDistrict || inferDistrict(rect.x, rect.z);
      const activeShape = draftBuildingSize.shape ?? 'rect';
      const triCorner = draftBuildingSize.triangleCorner ?? 0;
      const skewDeg = draftBuildingSize.skewDeg ?? 25;
      const footprint =
        activeShape === 'triangle'
          ? createTriangleFootprint(rect.x, rect.z, rect.width, rect.depth, rect.angleDeg, triCorner)
          : activeShape === 'circle'
          ? createCircleFootprint(rect.x, rect.z, rect.width, rect.depth, rect.angleDeg, 20)
          : activeShape === 'parallelogram'
          ? createParallelogramFootprint(rect.x, rect.z, rect.width, rect.depth, rect.angleDeg, skewDeg)
          : rect.footprint;
      const shapeType =
        activeShape === 'triangle'
          ? ('triangular' as const)
          : activeShape === 'circle'
          ? ('circular' as const)
          : activeShape === 'parallelogram'
          ? ('parallelogram' as const)
          : ('rectangular' as const);
      const rawCreated: Building3D = {
        id: `user-area-b-${Date.now()}`,
        name:
          activeShape === 'triangle'
            ? `Угловое здание (${rect.width}×${rect.depth} м)`
            : activeShape === 'parallelogram'
            ? `Параллелепипед (${rect.width}×${rect.depth} м)`
            : rect.snapped
            ? `Здание у ${streetName}`
            : `Здание (${rect.width}×${rect.depth} м)`,
        street: streetName,
        houseNumber: String(buildings.length + 1),
        district,
        category: 'residential',
        x: rect.x,
        z: rect.z,
        footprint,
        shapeType,
        skewDeg: activeShape === 'parallelogram' ? skewDeg : undefined,
        measuredWidth: rect.width,
        measuredDepth: rect.depth,
        orientationDeg: rect.angleDeg,
        floors,
        height,
        baseY: SERVER_GROUND_Y,
        roofY: SERVER_GROUND_Y + height,
        roofType: 'flat',
        isUserEdited: true,
      };

      let created = rawCreated;
      let updatedExisting: Building3D[] = [];
      if (autoHouseNumbering) {
        const autoRes = autoAddressNewBuilding(rawCreated, buildings, streets);
        created = autoRes.created;
        updatedExisting = autoRes.updatedExisting;
      }

      const bMap = new Map(cur.buildings.map((b) => [b.id, b]));
      for (const ub of updatedExisting) bMap.set(ub.id, ub);
      bMap.set(created.id, created);

      const next: MapEditsPayload = {
        ...cur,
        buildings: Array.from(bMap.values()),
      };
      persistEdits(next, true);
      setSelectedEntity({ type: 'building', data: created });
      const renumSuffix =
        updatedExisting.length > 0 ? ` · обновлено номеров: ${updatedExisting.length}` : '';
      setLastEditorNotice(
        `Создано здание ${rect.width}×${rect.depth} м (${created.street}, д. ${created.houseNumber}${renumSuffix})`
      );
      // Continuous rapid drawing: keep 'add-building' tool active!
    },
    [
      autoHouseNumbering,
      buildings,
      streets,
      draftBuildingSize.floors,
      draftBuildingSize.shape,
      draftBuildingSize.skewDeg,
      draftBuildingSize.triangleCorner,
      persistEdits,
    ]
  );

  // Universal Eraser: area-drag batch deletion of buildings, ROADS, parks/water, AND POIs!
  const handleDeleteObjectsInArea = useCallback(
    (minX: number, maxX: number, minZ: number, maxZ: number) => {
      const cur = editsRef.current;
      const hitBldgIds = buildings
        .filter((b) => b.x >= minX && b.x <= maxX && b.z >= minZ && b.z <= maxZ)
        .map((b) => b.id);
      const hitStreetIds = streets
        .filter((s) => polylineIntersectsRect(s.points, minX, maxX, minZ, maxZ))
        .map((s) => s.id);
      const hitLandIds = landFeatures
        .filter((f) => polylineIntersectsRect(f.polygon, minX, maxX, minZ, maxZ))
        .map((f) => f.id);
      const hitPoiIds = pois
        .filter((p) => p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ)
        .map((p) => p.id);

      if (
        hitBldgIds.length === 0 &&
        hitStreetIds.length === 0 &&
        hitLandIds.length === 0 &&
        hitPoiIds.length === 0
      ) {
        setLastEditorNotice('В выделенной области нет объектов для удаления.');
        return;
      }

      const bSet = new Set(hitBldgIds);
      const sSet = new Set(hitStreetIds);
      const lSet = new Set(hitLandIds);
      const pSet = new Set(hitPoiIds);

      const next: MapEditsPayload = {
        ...cur,
        buildings: cur.buildings.filter((b) => !bSet.has(b.id)),
        deletedBuildingIds: Array.from(new Set([...cur.deletedBuildingIds, ...hitBldgIds])),
        streets: cur.streets.filter((s) => !sSet.has(s.id)),
        deletedStreetIds: Array.from(new Set([...cur.deletedStreetIds, ...hitStreetIds])),
        landFeatures: (cur.landFeatures ?? []).filter((f) => !lSet.has(f.id)),
        deletedLandIds: Array.from(new Set([...(cur.deletedLandIds ?? []), ...hitLandIds])),
        pois: (cur.pois ?? []).filter((p) => !pSet.has(p.id)),
        deletedPoiIds: Array.from(new Set([...(cur.deletedPoiIds ?? []), ...hitPoiIds])),
      };
      if (hitBldgIds.length > 0) {
        setAutoBuildings((prev) => prev.filter((b) => !bSet.has(b.id)));
      }
      if (hitStreetIds.length > 0) {
        setAutoStreets((prev) => prev.filter((s) => !sSet.has(s.id)));
      }
      persistEdits(next, true);

      if (
        (selectedEntity?.type === 'building' && bSet.has(selectedEntity.data.id)) ||
        (selectedEntity?.type === 'street' && sSet.has(selectedEntity.data.id)) ||
        (selectedEntity?.type === 'land' && lSet.has(selectedEntity.data.id)) ||
        (selectedEntity?.type === 'poi' && pSet.has(selectedEntity.data.id))
      ) {
        setSelectedEntity(null);
      }

      const summary: string[] = [];
      if (hitBldgIds.length > 0) summary.push(`${hitBldgIds.length} зд.`);
      if (hitStreetIds.length > 0) summary.push(`${hitStreetIds.length} дор.`);
      if (hitLandIds.length > 0) summary.push(`${hitLandIds.length} терр.`);
      if (hitPoiIds.length > 0) summary.push(`${hitPoiIds.length} мет.`);
      setLastEditorNotice(`Стёрто ластиком: ${summary.join(', ')}`);
    },
    [buildings, streets, landFeatures, pois, persistEdits, selectedEntity]
  );

  // Single-click Eraser: erase clicked building, road, park/water polygon, or POI
  const handleEraseSingleObject = useCallback(
    (target: { type: 'building' | 'street' | 'land' | 'poi'; id: string }) => {
      if (target.type === 'building') {
        handleDeleteBuilding(target.id);
        setLastEditorNotice('Здание удалено ластиком');
      } else if (target.type === 'street') {
        handleDeleteStreet(target.id);
        setLastEditorNotice('Дорога удалена ластиком');
      } else if (target.type === 'poi') {
        handleDeletePoi(target.id);
        setLastEditorNotice('Метка удалена ластиком');
      } else {
        handleDeleteLandFeature(target.id);
        setLastEditorNotice('Территория удалена ластиком');
      }
    },
    [handleDeleteBuilding, handleDeleteStreet, handleDeletePoi, handleDeleteLandFeature]
  );

  const handleExportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(edits, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'murmaps-edits.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [edits]);

  const handleImportJson = useCallback(
    (jsonText: string): { ok: boolean; message: string } => {
      try {
        const parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== 'object') {
          return { ok: false, message: 'Неверный формат файла.' };
        }
        const next: MapEditsPayload = {
          buildings: Array.isArray(parsed.buildings) ? parsed.buildings : [],
          deletedBuildingIds: Array.isArray(parsed.deletedBuildingIds)
            ? parsed.deletedBuildingIds
            : [],
          streets: Array.isArray(parsed.streets) ? parsed.streets : [],
          deletedStreetIds: Array.isArray(parsed.deletedStreetIds)
            ? parsed.deletedStreetIds
            : [],
          landFeatures: Array.isArray(parsed.landFeatures) ? parsed.landFeatures : [],
          deletedLandIds: Array.isArray(parsed.deletedLandIds) ? parsed.deletedLandIds : [],
          pois: Array.isArray(parsed.pois) ? parsed.pois : [],
          deletedPoiIds: Array.isArray(parsed.deletedPoiIds) ? parsed.deletedPoiIds : [],
          places: Array.isArray(parsed.places) ? parsed.places : [],
          deletedPlaceIds: Array.isArray(parsed.deletedPlaceIds) ? parsed.deletedPlaceIds : [],
          stationOverrides:
            parsed.stationOverrides && typeof parsed.stationOverrides === 'object'
              ? parsed.stationOverrides
              : {},
          routeOverrides:
            parsed.routeOverrides && typeof parsed.routeOverrides === 'object'
              ? parsed.routeOverrides
              : {},
          updatedAt: new Date().toISOString(),
        };
        persistEdits(next);
        const msg = `Загружено сохранение: ${next.buildings.length} зд., ${next.streets.length} дор., ${next.landFeatures?.length ?? 0} терр., ${next.pois?.length ?? 0} мет.`;
        setSaveNotice({ ok: true, text: msg });
        setLastEditorNotice(msg);
        return {
          ok: true,
          message: msg,
        };
      } catch {
        const errMsg = 'Не удалось прочитать файл сохранения.';
        setSaveNotice({ ok: false, text: errMsg });
        return { ok: false, message: errMsg };
      }
    },
    [persistEdits]
  );

  const handleLoadSaveFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        handleImportJson(String(reader.result || ''));
      };
      reader.onerror = () => {
        setSaveNotice({ ok: false, text: 'Ошибка чтения выбранного файла.' });
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    },
    [handleImportJson]
  );

  // Keep selectedEntity synchronized with live state after undo, reset, or server refresh
  const resolvedSelectedEntity = useMemo<SelectedEntity | null>(() => {
    if (!selectedEntity) return null;
    if (selectedEntity.type === 'building') {
      const live = buildings.find((b) => b.id === selectedEntity.data.id);
      return live ? { type: 'building', data: live } : null;
    }
    if (selectedEntity.type === 'street') {
      const live = streets.find((s) => s.id === selectedEntity.data.id);
      return live ? { type: 'street', data: live } : null;
    }
    if (selectedEntity.type === 'land') {
      const live = landFeatures.find((f) => f.id === selectedEntity.data.id);
      return live ? { type: 'land', data: live } : null;
    }
    if (selectedEntity.type === 'poi') {
      const live = pois.find((p) => p.id === selectedEntity.data.id);
      return live ? { type: 'poi', data: live } : null;
    }
    if (selectedEntity.type === 'place') {
      const live = mapPlaces.find((p) => p.id === selectedEntity.data.id);
      return live ? { type: 'place', data: live } : null;
    }
    if (selectedEntity.type === 'station') {
      const live = stations.find((s) => s.id === selectedEntity.data.id);
      return live ? { type: 'station', data: live } : null;
    }
    if (selectedEntity.type === 'route') {
      const live = routes.find((r) => r.id === selectedEntity.data.id);
      return live ? { type: 'route', data: live } : null;
    }
    return selectedEntity;
  }, [selectedEntity, buildings, streets, landFeatures, pois, mapPlaces, stations, routes]);

  // Keyboard shortcuts: Esc (exit Photo Mode / cancel tools), Zoom (+/-), Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, Enter, Delete
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && photoMode) {
        e.preventDefault();
        setPhotoMode(false);
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && isEditorMode && !photoMode) {
        const keyLower = e.key.toLowerCase();
        if (keyLower === 'y' || (keyLower === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
          return;
        }
        if (keyLower === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        }
      }

      // Shift + +/- while drawing road/railway adjusts elevation above/below ground!
      if (isEditorMode && !photoMode && editorTool === 'add-street' && e.shiftKey) {
        if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault();
          setDraftStreetElevationY((prev) => {
            const next = Math.min(SERVER_GROUND_Y + 60, prev + 2);
            const rel = Math.round(next - SERVER_GROUND_Y);
            setLastEditorNotice(
              rel > 0
                ? `Уровень дороги: +${rel} м над землёй (Y=${next})`
                : rel < 0
                ? `Уровень дороги: ${rel} м под землёй (Y=${next})`
                : `Уровень земли (0 м, Y=${next})`
            );
            return next;
          });
          return;
        }
        if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          setDraftStreetElevationY((prev) => {
            const next = Math.max(SERVER_GROUND_Y - 30, prev - 2);
            const rel = Math.round(next - SERVER_GROUND_Y);
            setLastEditorNotice(
              rel > 0
                ? `Уровень дороги: +${rel} м над землёй (Y=${next})`
                : rel < 0
                ? `Уровень дороги: ${rel} м под землёй (Y=${next})`
                : `Уровень земли (0 м, Y=${next})`
            );
            return next;
          });
          return;
        }
      }

      if (e.key === '+' || e.key === '=') {
        setCamera((c) => ({ ...c, zoom: Math.min(MAX_MAP_ZOOM, c.zoom * 1.25) }));
        return;
      }
      if (e.key === '-') {
        setCamera((c) => ({ ...c, zoom: Math.max(MIN_MAP_ZOOM, c.zoom / 1.25) }));
        return;
      }
      if (e.key === 'Escape') {
        if (isSelectingSynthesisArea) {
          setIsSelectingSynthesisArea(false);
          return;
        }
        setPickMode(null);
        setEditorTool('select');
        setIsDrawingWing(false);
        setDraftBuildingPolygon([]);
        setMergeSourceBuildingId(null);
        setMultiSelectedItems([]);
        setIsMultiSelectMode(false);
        return;
      }

      if (!isEditorMode || photoMode) return;

      // Enter: merge multi-selected buildings OR close synthesis polygon OR create active draft object
      if (e.key === 'Enter') {
        if (multiSelectedBuildingIds.length >= 2) {
          e.preventDefault();
          handleMergeMultiSelectedBuildings();
          return;
        }
        if (
          editorTool === 'synthesis' &&
          !isSynthesisPolygonClosed &&
          synthesisPolygon.length >= 3
        ) {
          e.preventDefault();
          handleFinishSynthesisPolygon();
          return;
        }
        if (editorTool === 'add-street' && draftStreetPoints.length >= 2) {
          e.preventDefault();
          const mid = draftStreetPoints[Math.floor(draftStreetPoints.length / 2)];
          const pts3D =
            draftStreetPoints3D.length === draftStreetPoints.length
              ? draftStreetPoints3D
              : undefined;
          const defaultWidth =
            draftStreetRoadClass === 'railway'
              ? 8
              : draftStreetRoadClass === 'highway'
              ? 26
              : draftStreetRoadClass === 'avenue'
              ? 20
              : draftStreetRoadClass === 'service' || draftStreetRoadClass === 'dirt'
              ? 6
              : draftStreetRoadClass === 'pedestrian'
              ? 5
              : 14;
          const createdStreet: StreetSegment = {
            id: `user-st-${Date.now()}`,
            name:
              draftStreetRoadClass === 'railway'
                ? `ЖД путь #${streets.length + 1}`
                : draftStreetRoadClass === 'dirt'
                ? `Грунтовая дорога #${streets.length + 1}`
                : draftStreetRoadClass === 'service'
                ? `Проезд #${streets.length + 1}`
                : `Дорога #${streets.length + 1}`,
            district: inferDistrict(mid.x, mid.z),
            roadClass: draftStreetRoadClass,
            width: defaultWidth,
            elevationY: draftStreetElevationY,
            oneWay:
              draftStreetRoadClass === 'railway' || draftStreetRoadClass === 'pedestrian'
                ? 'none'
                : draftStreetOneWay,
            simAllowed: draftStreetRoadClass !== 'railway' && draftStreetRoadClass !== 'pedestrian',
            points: draftStreetPoints,
            points3D: pts3D,
            isUserEdited: true,
          };
          handleSaveStreet(createdStreet);
          return;
        }
        if (editorTool === 'add-land' && draftLandPoints.length >= 3) {
          e.preventDefault();
          const kind = draftLandKind;
          const createdLand: LandFeature = {
            id: `user-land-${Date.now()}`,
            name: kind === 'water' ? 'Водоём' : kind === 'square' ? 'Площадь' : 'Парк / сквер',
            kind,
            polygon: draftLandPoints,
            isUserEdited: true,
          };
          handleSaveLandFeature(createdLand);
          return;
        }
        if (
          draftBuildingPolygon.length >= 3 &&
          ((editorTool === 'add-building' && draftBuildingSize.shape === 'polygon') ||
            (isDrawingWing && draftBuildingSize.shape === 'polygon'))
        ) {
          e.preventDefault();
          handleFinishBuildingPolygon();
          return;
        }
        if (editorTool === 'add-building' && draftBuildingSize.shape !== 'polygon') {
          e.preventDefault();
          const center = draftBuildingCenter ?? {
            x: Math.round(camera.x),
            z: Math.round(camera.z),
          };
          const w = Math.max(1, draftBuildingSize.width);
          const d = Math.max(1, draftBuildingSize.depth);
          if ((snapToRoad && streets.length > 0) || (snapToBuilding && buildings.length > 0)) {
            const p1 = { x: center.x - w * 0.5, z: center.z - d * 0.5 };
            const p2 = { x: center.x + w * 0.5, z: center.z + d * 0.5 };
            const snapped = snapBuildingRectToStreet(
              p1,
              p2,
              streets,
              snapToRoad,
              undefined,
              buildings,
              undefined,
              snapToBuilding
            );
            handleCreateBuildingFromArea(snapped);
          } else {
            const shape = draftBuildingSize.shape ?? 'rect';
            const footprint =
              shape === 'circle'
                ? createCircleFootprint(center.x, center.z, w, d, draftBuildingSize.angle)
                : shape === 'triangle'
                ? createTriangleFootprint(
                    center.x,
                    center.z,
                    w,
                    d,
                    draftBuildingSize.angle,
                    draftBuildingSize.triangleCorner ?? 0
                  )
                : shape === 'parallelogram'
                ? createParallelogramFootprint(
                    center.x,
                    center.z,
                    w,
                    d,
                    draftBuildingSize.angle,
                    draftBuildingSize.skewDeg ?? 25
                  )
                : createRectFootprint(center.x, center.z, w, d, draftBuildingSize.angle);
            const rect: RoadSnappedBuildingRect = {
              x: center.x,
              z: center.z,
              width: w,
              depth: d,
              angleDeg: draftBuildingSize.angle,
              footprint,
              snapped: false,
            };
            handleCreateBuildingFromArea(rect);
          }
          return;
        }
      }

      // Delete / Backspace: pop last vertex while drawing OR delete selected object (with Undo)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (
          draftBuildingPolygon.length > 0 &&
          ((editorTool === 'add-building' && draftBuildingSize.shape === 'polygon') ||
            (isDrawingWing && draftBuildingSize.shape === 'polygon'))
        ) {
          e.preventDefault();
          handlePopBuildingPolygonPoint();
          return;
        }
        if (
          editorTool === 'synthesis' &&
          !isSynthesisPolygonClosed &&
          synthesisPolygon.length > 0
        ) {
          e.preventDefault();
          handlePopSynthesisVertex();
          return;
        }
        if (editorTool === 'add-street' && draftStreetPoints.length > 0) {
          e.preventDefault();
          setDraftStreetPoints((prev) => prev.slice(0, -1));
          setDraftStreetPoints3D((prev) => prev.slice(0, -1));
          return;
        }
        if (editorTool === 'add-land' && draftLandPoints.length > 0) {
          e.preventDefault();
          setDraftLandPoints((prev) => prev.slice(0, -1));
          return;
        }
        if (multiSelectedItems.length >= 2 || (isMultiSelectMode && multiSelectedItems.length >= 1)) {
          e.preventDefault();
          handleBatchDeleteMultiSelected();
          return;
        }
        if (resolvedSelectedEntity) {
          if (resolvedSelectedEntity.type === 'building') {
            e.preventDefault();
            handleDeleteBuilding(resolvedSelectedEntity.data.id);
            setLastEditorNotice('Здание удалено (Delete · Ctrl+Z для отмены)');
          } else if (resolvedSelectedEntity.type === 'street') {
            e.preventDefault();
            handleDeleteStreet(resolvedSelectedEntity.data.id);
            setLastEditorNotice('Дорога удалена (Delete · Ctrl+Z для отмены)');
          } else if (resolvedSelectedEntity.type === 'land') {
            e.preventDefault();
            handleDeleteLandFeature(resolvedSelectedEntity.data.id);
            setLastEditorNotice('Территория удалена (Delete · Ctrl+Z для отмены)');
          } else if (resolvedSelectedEntity.type === 'poi') {
            e.preventDefault();
            handleDeletePoi(resolvedSelectedEntity.data.id);
            setLastEditorNotice('Метка удалена (Delete · Ctrl+Z для отмены)');
          } else if (resolvedSelectedEntity.type === 'place') {
            e.preventDefault();
            handleDeletePlace(resolvedSelectedEntity.data.id);
            setLastEditorNotice('Надпись города/района удалена (Delete · Ctrl+Z для отмены)');
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    photoMode,
    isEditorMode,
    isSelectingSynthesisArea,
    isSynthesisPolygonClosed,
    synthesisPolygon.length,
    multiSelectedBuildingIds.length,
    multiSelectedItems.length,
    isMultiSelectMode,
    handleMergeMultiSelectedBuildings,
    handleBatchDeleteMultiSelected,
    handleUndo,
    handleRedo,
    handleFinishSynthesisPolygon,
    handlePopSynthesisVertex,
    editorTool,
    draftStreetPoints,
    draftStreetPoints3D,
    draftStreetElevationY,
    draftStreetRoadClass,
    draftStreetOneWay,
    draftLandPoints,
    draftLandKind,
    draftBuildingCenter,
    draftBuildingPolygon.length,
    draftBuildingSize,
    isDrawingWing,
    handleFinishBuildingPolygon,
    handlePopBuildingPolygonPoint,
    camera.x,
    camera.z,
    snapToRoad,
    snapToBuilding,
    streets,
    buildings,
    resolvedSelectedEntity,
    handleSaveStreet,
    handleSaveLandFeature,
    handleCreateBuildingFromArea,
    handleDeleteBuilding,
    handleDeleteStreet,
    handleDeleteLandFeature,
    handleDeletePoi,
    handleDeletePlace,
  ]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#F4F2EA] dark:bg-[#191B20]">
      {/* Primary Full-Viewport Map Layer */}
      <main className="w-full h-full relative" aria-label="Интерактивная карта MURMaps">
        <MapCanvas3D
          camera={camera}
          onCameraChange={setCamera}
          darkMode={darkMode}
          mapStyle={mapStyle}
          layers={layers}
          insolation={insolation}
          isEditorMode={isEditorMode}
          photoMode={photoMode}
          landFeatures={landFeatures}
          blueMapTiles={blueMapTiles}
          streets={streets}
          buildings={buildings}
          pois={pois}
          places={mapPlaces}
          stations={stations}
          routes={routes}
          departuresMap={departuresMap}
          serverClockOffsetMs={serverClockOffsetMs}
          activeRoute={activeRoute}
          pointA={pointA}
          pointB={pointB}
          selectedEntity={resolvedSelectedEntity}
          editorTool={isEditorMode ? editorTool : 'select'}
          snapToRoad={snapToRoad}
          snapToBuilding={snapToBuilding}
          snapToLand={snapToLand}
          synthesisPolygon={isEditorMode && editorTool === 'synthesis' ? synthesisPolygon : []}
          isSynthesisPolygonClosed={isSynthesisPolygonClosed}
          isSelectingSynthesisArea={
            isEditorMode && editorTool === 'synthesis' && isSelectingSynthesisArea
          }
          draftStreetPoints={draftStreetPoints}
          draftStreetPoints3D={draftStreetPoints3D}
          draftStreetElevationY={draftStreetElevationY}
          draftStreetRoadClass={draftStreetRoadClass}
          draftPoiIcon={draftPoiIcon}
          draftPlaceTier={draftPlaceTier}
          draftLandPoints={draftLandPoints}
          draftLandKind={draftLandKind}
          draftBuildingPolygon={draftBuildingPolygon}
          draftBuildingSize={draftBuildingSize}
          pickMode={isEditorMode ? null : pickMode}
          activeWingId={activeWingId}
          isDrawingWing={isEditorMode && isDrawingWing}
          mergeSourceBuildingId={isEditorMode ? mergeSourceBuildingId : null}
          multiSelectedItems={isEditorMode ? multiSelectedItems : []}
          multiSelectedBuildingIds={isEditorMode ? multiSelectedBuildingIds : []}
          multiSelectMode={isEditorMode && editorTool === 'select' && isMultiSelectMode}
          onSelectEntity={handleSelectEntity}
          onSelectBuildingWithWing={handleSelectBuildingWithWing}
          onMapClickForEditor={handleMapClickForEditor}
          onAddBuildingPolygonPoint={handleAddBuildingPolygonPoint}
          onFinishBuildingPolygon={handleFinishBuildingPolygon}
          onResizeBuilding={handleResizeBuilding}
          onResizeStreet={handleResizeStreet}
          onResizeLandFeature={handleResizeLandFeature}
          onMoveStation={handleMoveStation}
          onMovePoi={handleMovePoi}
          onMovePlace={handleMovePlace}
          onUpdateRoutePath={handleUpdateRoutePath}
          onCreateBuildingFromArea={handleCreateBuildingFromArea}
          onAddWingFromArea={handleAddWingFromArea}
          onCompleteMergeBuilding={handleCompleteMergeBuilding}
          onQuickMergeBuildings={handleQuickMergeBuildings}
          onToggleMultiSelectEntity={handleToggleMultiSelectEntity}
          onToggleMultiSelectBuilding={handleToggleMultiSelectBuilding}
          onAddMultiSelectEntities={handleAddMultiSelectEntities}
          onDeleteObjectsInArea={handleDeleteObjectsInArea}
          onEraseSingleObject={handleEraseSingleObject}
          onAddSynthesisVertex={handleAddSynthesisVertex}
          onMoveSynthesisVertex={handleMoveSynthesisVertex}
          onFinishSynthesisPolygon={handleFinishSynthesisPolygon}
          onPickRoutePoint={handlePickRoutePoint}
          onSetRoutePointFromContext={handlePickRoutePoint}
          onOpenBlueMapAt={handleOpenBlueMapAt}
          onCursorMove={handleCursorMove}
          onBeginDragEdit={handleBeginDragEdit}
          onEndDragEdit={handleEndDragEdit}
        />
      </main>

      {/* Brief auto-fading Esc hint in Photo Mode (no persistent buttons) */}
      {photoMode && photoHintVisible && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div
            role="status"
            onClick={() => setPhotoMode(false)}
            className="px-3.5 py-1.5 rounded-xl bg-neutral-950/75 text-white text-xs font-medium backdrop-blur-md shadow-lg cursor-pointer select-none murs-anim-slide-down"
          >
            Фоторежим · Нажмите <span className="font-mono font-bold text-[#FFCC00]">Esc</span> для выхода
          </div>
        </div>
      )}

      {/* Full Graphical Map Editor Mode (Yandex Народная карта style) */}
      {!photoMode && isEditorMode && (
        <EditorPanel
          editorTool={editorTool}
          mapStyle={mapStyle}
          terrainRelief={layers.terrainRelief}
          selectedEntity={resolvedSelectedEntity}
          routes={routes}
          draftBuildingCenter={draftBuildingCenter}
          draftBuildingPolygon={draftBuildingPolygon}
          draftBuildingSize={draftBuildingSize}
          onFinishBuildingPolygon={handleFinishBuildingPolygon}
          onPopBuildingPolygonPoint={handlePopBuildingPolygonPoint}
          onClearBuildingPolygon={handleClearBuildingPolygon}
          onConvertWingToFreeform={handleConvertWingToFreeform}
          draftStreetPoints={draftStreetPoints}
          draftStreetPoints3D={draftStreetPoints3D}
          draftStreetElevationY={draftStreetElevationY}
          draftStreetRoadClass={draftStreetRoadClass}
          draftStreetOneWay={draftStreetOneWay}
          onChangeDraftStreetElevationY={setDraftStreetElevationY}
          onChangeDraftStreetRoadClass={setDraftStreetRoadClass}
          onChangeDraftStreetOneWay={setDraftStreetOneWay}
          draftLandPoints={draftLandPoints}
          draftLandKind={draftLandKind}
          onChangeDraftLandKind={setDraftLandKind}
          draftPoiCenter={draftPoiCenter}
          draftPoiIcon={draftPoiIcon}
          onChangeDraftPoiIcon={setDraftPoiIcon}
          poisCount={pois.length}
          onSavePoi={handleSavePoi}
          onDeletePoi={handleDeletePoi}
          places={mapPlaces}
          draftPlaceCenter={draftPlaceCenter}
          draftPlaceTier={draftPlaceTier}
          onChangeDraftPlaceTier={setDraftPlaceTier}
          onSavePlace={handleSavePlace}
          onDeletePlace={handleDeletePlace}
          onSelectPlace={handleSelectPlaceFromList}
          onResetDefaultPlaces={handleResetDefaultPlaces}
          multiSelectedItems={multiSelectedItems}
          multiSelectedBuildingIds={multiSelectedBuildingIds}
          multiSelectMode={isMultiSelectMode}
          onToggleMultiSelectMode={() => {
            setIsMultiSelectMode((prev) => {
              const next = !prev;
              if (
                next &&
                multiSelectedItems.length === 0 &&
                resolvedSelectedEntity &&
                (resolvedSelectedEntity.type === 'building' ||
                  resolvedSelectedEntity.type === 'street' ||
                  resolvedSelectedEntity.type === 'land' ||
                  resolvedSelectedEntity.type === 'poi' ||
                  resolvedSelectedEntity.type === 'place')
              ) {
                setMultiSelectedItems([
                  { type: resolvedSelectedEntity.type, id: resolvedSelectedEntity.data.id },
                ]);
              }
              return next;
            });
          }}
          onRemoveMultiSelectKind={handleRemoveMultiSelectKind}
          onMergeMultiSelectedBuildings={handleMergeMultiSelectedBuildings}
          onClearMultiSelectBuildings={() => {
            setMultiSelectedItems([]);
            setIsMultiSelectMode(false);
          }}
          onBatchDeleteMultiSelected={handleBatchDeleteMultiSelected}
          onBatchUpdateBuildings={handleBatchUpdateBuildings}
          onBatchUpdateStreets={handleBatchUpdateStreets}
          onBatchUpdateLandFeatures={handleBatchUpdateLandFeatures}
          onBatchUpdatePois={handleBatchUpdatePois}
          onBatchUpdatePlaces={handleBatchUpdatePlaces}
          snapToRoad={snapToRoad}
          snapToBuilding={snapToBuilding}
          snapToLand={snapToLand}
          autoHouseNumbering={autoHouseNumbering}
          onToggleAutoHouseNumbering={() => setAutoHouseNumbering((v) => !v)}
          onRenumberStreetBuildings={handleRenumberStreetBuildings}
          lastEditorNotice={lastEditorNotice}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          userBuildingsCount={edits.buildings.length}
          userStreetsCount={edits.streets.length}
          userLandCount={edits.landFeatures?.length ?? 0}
          movedStationsCount={Object.keys(edits.stationOverrides ?? {}).length}
          movedRoutesCount={Object.keys(edits.routeOverrides ?? {}).length}
          hasStationOverride={(id) => Boolean(edits.stationOverrides?.[id])}
          hasRouteOverride={(id) => Boolean(edits.routeOverrides?.[id])}
          onExitEditor={() => {
            setIsEditorMode(false);
            setEditorTool('select');
            setIsSelectingSynthesisArea(false);
            setDraftStreetPoints([]);
            setDraftStreetPoints3D([]);
            setDraftLandPoints([]);
            setDraftBuildingPolygon([]);
            setIsDrawingWing(false);
            setMergeSourceBuildingId(null);
            setMultiSelectedItems([]);
            setIsMultiSelectMode(false);
          }}
          onChangeMapStyle={setMapStyle}
          onToggleTerrainRelief={() =>
            setLayers((prev) => ({ ...prev, terrainRelief: !prev.terrainRelief }))
          }
          onUndo={handleUndo}
          onRedo={handleRedo}
          onChangeTool={(t) => {
            setEditorTool(t);
            setLastEditorNotice(null);
            setIsDrawingWing(false);
            setDraftBuildingPolygon([]);
            setMergeSourceBuildingId(null);
            setMultiSelectedItems([]);
            setIsMultiSelectMode(false);
            if (t !== 'synthesis') {
              setIsSelectingSynthesisArea(false);
            }
            if (
              t === 'add-building' ||
              t === 'add-street' ||
              t === 'add-land' ||
              t === 'add-poi' ||
              t === 'add-place'
            ) {
              setSelectedEntity(null);
            }
          }}
          onToggleSnapToRoad={() => setSnapToRoad((v) => !v)}
          onToggleSnapToBuilding={() => setSnapToBuilding((v) => !v)}
          onToggleSnapToLand={() => setSnapToLand((v) => !v)}
          onChangeDraftBuildingSize={setDraftBuildingSize}
          onPopStreetPoint={() => {
            setDraftStreetPoints((prev) => prev.slice(0, -1));
            setDraftStreetPoints3D((prev) => prev.slice(0, -1));
          }}
          onClearStreetPoints={() => {
            setDraftStreetPoints([]);
            setDraftStreetPoints3D([]);
          }}
          onPopLandPoint={() => setDraftLandPoints((prev) => prev.slice(0, -1))}
          onClearLandPoints={() => setDraftLandPoints([])}
          onSaveBuilding={handleSaveBuilding}
          onDeleteBuilding={handleDeleteBuilding}
          activeWingId={activeWingId}
          isDrawingWing={isDrawingWing}
          mergeSourceBuildingId={mergeSourceBuildingId}
          onSelectWing={setActiveWingId}
          onRotateBuilding={handleRotateBuilding}
          onAddWingQuick={handleAddWingQuick}
          onToggleDrawWing={() => {
            setMergeSourceBuildingId(null);
            setIsDrawingWing((v) => !v);
          }}
          onRemoveWing={handleRemoveWing}
          onToggleMergeBuilding={(buildingId) => {
            setIsDrawingWing(false);
            setMergeSourceBuildingId((prev) => (prev === buildingId ? null : buildingId));
          }}
          onSplitBuilding={handleSplitBuilding}
          onSaveStreet={handleSaveStreet}
          onDeleteStreet={handleDeleteStreet}
          onSaveLandFeature={handleSaveLandFeature}
          onDeleteLandFeature={handleDeleteLandFeature}
          onUpdateStationOverride={handleUpdateStationOverride}
          onResetStationOverride={handleResetStationOverride}
          onResetRouteOverride={handleResetRouteOverride}
          onSelectRouteById={(routeId) => {
            const rt = routes.find((r) => r.id === routeId);
            if (rt) {
              setSelectedEntity({ type: 'route', data: rt });
              const mid = rt.stops[Math.floor(rt.stops.length / 2)];
              if (mid) flyTo(mid.x, mid.z, Math.max(camera.zoom, 0.34));
            }
          }}
          onResetAllEdits={() => {
            persistEdits(EMPTY_EDITS);
            setSelectedEntity(null);
            setDraftStreetPoints([]);
            setDraftStreetPoints3D([]);
            setDraftLandPoints([]);
            setMultiSelectedItems([]);
            setLastEditorNotice('Все пользовательские правки сброшены');
          }}
          onExportJson={handleExportJson}
          onImportJson={handleImportJson}
          isSelectingSynthesisArea={isSelectingSynthesisArea}
          synthesisPolygonCount={synthesisPolygon.length}
          onFinishSynthesisPolygon={handleFinishSynthesisPolygon}
          onPopSynthesisVertex={handlePopSynthesisVertex}
          onCancelSelectSynthesisArea={() => setIsSelectingSynthesisArea(false)}
          synthesisPanel={
            <SynthesisPanel
              isRunning={synthesisRunning}
              stats={
                synthesisStats
                  ? {
                      ...synthesisStats,
                      routesSnapped: tracedTransitResult.routesSnapped,
                      totalSurfaceRoutes: tracedTransitResult.totalSurfaceRoutes,
                      avgStreetCoveragePct: tracedTransitResult.avgStreetCoveragePct,
                    }
                  : null
              }
              error={synthesisError}
              options={synthesisOptions}
              synthesisPolygon={synthesisPolygon}
              isSynthesisPolygonClosed={isSynthesisPolygonClosed}
              isSelectingSynthesisArea={isSelectingSynthesisArea}
              blueMapUnderlay={layers.blueMapUnderlay}
              unsavedBuildingsCount={autoBuildings.length}
              unsavedStreetsCount={autoStreets.length}
              savedTotalBuildings={edits.buildings.length}
              savedTotalStreets={edits.streets.length}
              autoSaveSynthesis={autoSaveSynthesis}
              saveNotice={saveSynthNotice}
              magicStatus={magicStatus}
              magicRefreshing={magicRefreshing}
              onChangeOptions={setSynthesisOptions}
              onToggleSelectArea={() => {
                if (!isSelectingSynthesisArea && isSynthesisPolygonClosed) {
                  setSynthesisPolygon([]);
                  setIsSynthesisPolygonClosed(false);
                  setIsSelectingSynthesisArea(true);
                } else {
                  setIsSelectingSynthesisArea((v) => !v);
                }
              }}
              onFinishSynthesisPolygon={handleFinishSynthesisPolygon}
              onPopSynthesisVertex={handlePopSynthesisVertex}
              onClearSynthesisArea={() => {
                setSynthesisPolygon([]);
                setIsSynthesisPolygonClosed(false);
                setIsSelectingSynthesisArea(false);
              }}
              onToggleBlueMapUnderlay={() =>
                setLayers((prev) => ({ ...prev, blueMapUnderlay: !prev.blueMapUnderlay }))
              }
              onToggleAutoSave={() => setAutoSaveSynthesis((v) => !v)}
              onSaveSynthesisToMap={() => commitSynthesizedToMap(autoBuildings, autoStreets)}
              onRefreshMagicApi={handleRefreshMagicApi}
              onImportMagicJson={handleImportMagicJson}
              onRunSynthesis={() => {
                if (!isSynthesisPolygonClosed || synthesisPolygon.length < 3) {
                  if (synthesisPolygon.length >= 3) {
                    handleFinishSynthesisPolygon();
                    runBlueMapSynthesis(synthesisPolygon, synthesisOptions);
                  } else {
                    setIsSelectingSynthesisArea(true);
                  }
                  return;
                }
                runBlueMapSynthesis(synthesisPolygon, synthesisOptions);
              }}
              onRunMagicTrajectorySynthesis={handleRunMagicTrajectorySynthesis}
              onClearSynthesis={() => {
                setAutoBuildings([]);
                setAutoStreets([]);
                setSynthesisStats(null);
                setSaveSynthNotice(null);
                try {
                  localStorage.removeItem(SYNTH_CACHE_KEY);
                } catch {
                  // ignore
                }
              }}
            />
          }
        />
      )}

      {/* Yandex Maps-Style Left Floating Navigator Sidebar (Desktop) + Touch-Draggable Bottom-Sheet Slider (Mobile) */}
      {!photoMode && !isEditorMode && (() => {
        const hasBothRouteEndpoints = Boolean(pointA && pointB);
        const mobileSheetBaseHeightPx =
          mobileSheetSnap === 'collapsed'
            ? 84
            : mobileSheetSnap === 'compact'
            ? activeTab === 'route'
              ? hasBothRouteEndpoints
                ? 395
                : 215
              : resolvedSelectedEntity
              ? 330
              : 320
            : Math.round(
                (typeof window !== 'undefined' ? window.innerHeight : 820) * 0.86
              );

        const maxMobilePx = Math.round(
          (typeof window !== 'undefined' ? window.innerHeight : 820) * 0.9
        );
        const mobileComputedHeightPx = Math.max(
          74,
          Math.min(maxMobilePx, mobileSheetBaseHeightPx - mobileDragDeltaY)
        );

        const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
          if (!isMobileViewport) return;
          if ((e.target as HTMLElement).closest('button, input')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          mobileDragStartRef.current = {
            y: e.clientY,
            startSnap: mobileSheetSnap,
            pointerId: e.pointerId,
          };
          setMobileDragging(true);
          setMobileDragDeltaY(0);
        };

        const handleSheetPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
          const st = mobileDragStartRef.current;
          if (!st || st.pointerId !== e.pointerId) return;
          setMobileDragDeltaY(e.clientY - st.y);
        };

        const handleSheetPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
          const st = mobileDragStartRef.current;
          if (!st || st.pointerId !== e.pointerId) return;
          const dy = e.clientY - st.y;
          mobileDragStartRef.current = null;
          setMobileDragging(false);
          setMobileDragDeltaY(0);

          let nextSnap = st.startSnap;
          if (dy < -140) {
            nextSnap = 'expanded';
          } else if (dy < -42) {
            nextSnap = st.startSnap === 'collapsed' ? 'compact' : 'expanded';
          } else if (dy > 140) {
            nextSnap = 'collapsed';
          } else if (dy > 42) {
            nextSnap = st.startSnap === 'expanded' ? 'compact' : 'collapsed';
          }
          setMobileSheetSnap(nextSnap);
          setSidebarOpen(nextSnap !== 'collapsed');
        };

        const isMobileCollapsed = isMobileViewport && mobileSheetSnap === 'collapsed';
        const isMobileCompactRoute =
          isMobileViewport && mobileSheetSnap === 'compact' && activeTab === 'route';

        return (
          <aside
            aria-label="Панель навигации и поиска"
            style={isMobileViewport ? { height: `${mobileComputedHeightPx}px` } : undefined}
            className={`fixed z-40 sm:z-20 inset-x-0 bottom-0 sm:inset-auto sm:top-4 sm:left-4 sm:bottom-4 flex items-start ${
              mobileDragging
                ? ''
                : 'transition-[height,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
            } ${
              sidebarOpen
                ? 'sm:translate-x-0'
                : 'sm:-translate-x-[calc(100%+16px)] sm:pointer-events-auto'
            }`}
          >
            <div className="w-full sm:w-[380px] h-full flex flex-col rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#1E2027] border-t sm:border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_-8px_32px_rgba(0,0,0,0.16)] sm:shadow-[0_8px_32px_rgba(0,0,0,0.14)] overflow-hidden pointer-events-auto murs-anim-slide-right">
              {/* Mobile Touch-Draggable Slider Grab Handle Bar */}
              <div
                onPointerDown={handleSheetPointerDown}
                onPointerMove={handleSheetPointerMove}
                onPointerUp={handleSheetPointerUp}
                onPointerCancel={handleSheetPointerUp}
                onClick={() => {
                  if (!isMobileViewport || mobileDragging) return;
                  if (mobileSheetSnap === 'collapsed') {
                    setMobileSheetSnap('compact');
                    setSidebarOpen(true);
                  } else if (mobileSheetSnap === 'compact') {
                    setMobileSheetSnap('expanded');
                  } else {
                    setMobileSheetSnap('compact');
                  }
                }}
                role="slider"
                aria-label="Потяните панель вверх или вниз"
                aria-valuemin={0}
                aria-valuemax={2}
                aria-valuenow={
                  mobileSheetSnap === 'collapsed' ? 0 : mobileSheetSnap === 'compact' ? 1 : 2
                }
                tabIndex={0}
                className="sm:hidden w-full pt-2.5 pb-1.5 flex flex-col items-center justify-center touch-none cursor-grab active:cursor-grabbing shrink-0 select-none"
              >
                <span className="w-11 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />
              </div>

              {/* Mobile Collapsed Dock View (inside the bottom slider!) */}
              {isMobileCollapsed ? (
                <div className="sm:hidden px-3 pb-2.5 grid grid-cols-3 gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('explore');
                      setMobileSheetSnap('expanded');
                      setSidebarOpen(true);
                    }}
                    className="min-h-[44px] rounded-xl bg-neutral-100 dark:bg-[#282B33] active:bg-neutral-200 text-neutral-900 dark:text-white text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <Search className="w-4 h-4 text-[#FC3F1D]" aria-hidden="true" />
                    <span>Поиск</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('route');
                      setMobileSheetSnap('compact');
                      setSidebarOpen(true);
                    }}
                    className="min-h-[44px] rounded-xl bg-[#FFCC00] active:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <Navigation className="w-4 h-4" aria-hidden="true" />
                    <span>Маршрут</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditorMode(true);
                      setPickMode(null);
                      setEditorTool('select');
                      if (mapStyle === 'bluemap') setMapStyle('vector');
                    }}
                    className="min-h-[44px] rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                    <span>Редактор</span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Brand + Search Header (hidden in mobile compact route mode so ONLY Point A & B show!) */}
                  {!isMobileCompactRoute && (
                    <div
                      onPointerDown={handleSheetPointerDown}
                      onPointerMove={handleSheetPointerMove}
                      onPointerUp={handleSheetPointerUp}
                      onPointerCancel={handleSheetPointerUp}
                      className="px-3.5 pt-1 sm:pt-3.5 pb-2.5 border-b border-neutral-200/80 dark:border-neutral-700/80 space-y-2.5 touch-pan-x sm:touch-auto"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-8 h-8 rounded-lg bg-sky-50/90 dark:bg-sky-950/45 border border-sky-200/80 dark:border-sky-500/25 flex items-center justify-center shrink-0 p-0.5"
                            aria-hidden="true"
                          >
                            <img
                              src="/assets/aistudio/____________8ba2e7f1.png"
                              alt=""
                              className="w-full h-full object-contain select-none"
                              draggable={false}
                            />
                          </span>
                          <h1 className="text-base font-bold tracking-tight text-neutral-950 dark:text-white whitespace-nowrap truncate">
                            MURMaps
                          </h1>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                            <span>{stations.length} ост.</span>
                            <span aria-hidden="true">·</span>
                            <span>{mtrSource === 'live' ? 'В сети' : 'Муроморск'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setMobileSheetSnap('collapsed');
                              setSidebarOpen(false);
                            }}
                            aria-label="Свернуть панель"
                            className="sm:hidden w-8 h-8 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-neutral-700 dark:text-neutral-200 flex items-center justify-center"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Unified Smart Search Input (streets, house numbers, abbreviations, categories, POIs) */}
                      <div className="relative flex items-center">
                        <Search
                          className="w-4 h-4 text-neutral-400 absolute left-3 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="search"
                          aria-label="Поиск адресов, улиц, типов зданий, меток или координат"
                          placeholder="Адрес, остановка, «вокзал», «библиотека», «тц»…"
                          value={searchQuery}
                          onFocus={() => {
                            if (isMobileViewport && mobileSheetSnap !== 'expanded') {
                              setMobileSheetSnap('expanded');
                            }
                          }}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            if (activeTab !== 'explore') setActiveTab('explore');
                          }}
                          className="w-full h-10 pl-9 pr-9 rounded-xl bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-950 dark:text-white placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                        />
                        {searchQuery && (
                          <button
                            type="button"
                            aria-label="Очистить поиск"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 p-1 text-neutral-400 hover:text-neutral-800 dark:hover:text-white"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {/* 2-Tab Navigation: Address/Place Search & Route Building */}
                      <nav
                        aria-label="Разделы навигатора"
                        className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-[#282B33]"
                      >
                        {(
                          [
                            { id: 'explore', label: 'Поиск', icon: Search },
                            { id: 'route', label: 'Маршрут', icon: Navigation },
                          ] as const
                        ).map((tab) => {
                          const Icon = tab.icon;
                          const active = activeTab === tab.id;
                          return (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => {
                                setActiveTab(tab.id);
                                if (isMobileViewport && tab.id === 'route') {
                                  setMobileSheetSnap('compact');
                                }
                              }}
                              className={`h-8 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                                active
                                  ? 'bg-white dark:bg-[#1B1E24] text-neutral-950 dark:text-white shadow-sm'
                                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white'
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>{tab.label}</span>
                            </button>
                          );
                        })}
                      </nav>
                    </div>
                  )}

                  {/* Minimal compact header bar when in Mobile Compact Route mode */}
                  {isMobileCompactRoute && (
                    <div
                      onPointerDown={handleSheetPointerDown}
                      onPointerMove={handleSheetPointerMove}
                      onPointerUp={handleSheetPointerUp}
                      onPointerCancel={handleSheetPointerUp}
                      className="sm:hidden px-4 pb-1 flex items-center justify-between gap-2 touch-none"
                    >
                      <span className="text-xs font-bold text-neutral-900 dark:text-white">
                        {hasBothRouteEndpoints ? 'Кратчайшие маршруты' : 'Построить маршрут'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setMobileSheetSnap('expanded')}
                          className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-[#2B2E37]"
                        >
                          Подробнее
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMobileSheetSnap('collapsed');
                            setSidebarOpen(false);
                          }}
                          aria-label="Свернуть маршрут"
                          className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-neutral-700 dark:text-neutral-200 flex items-center justify-center"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Main Scrollable Tab Body */}
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {activeTab === 'route' && (
                      <RoutePanel
                        pointA={pointA}
                        pointB={pointB}
                        travelMode={travelMode}
                        simVehicle={simVehicle}
                        pickMode={pickMode}
                        transitRoutes={transitRoutes}
                        autoRoute={autoRoute}
                        walkRoute={walkRoute}
                        simRoute={simRoute}
                        selectedTransitIdx={selectedTransitIdx}
                        stations={stations}
                        buildings={buildings}
                        streets={streets}
                        pois={pois}
                        compactMobile={isMobileCompactRoute}
                        onRequestExpandMobile={() => setMobileSheetSnap('expanded')}
                        departureTimeMode={departureTimeMode}
                        customDepartureTime={customDepartureTime}
                        effectiveDepartureMs={effectiveDepartureMs}
                        onChangeDepartureTimeMode={(mode) => {
                          setDepartureTimeMode(mode);
                          if (mode === 'now') {
                            const now = Date.now();
                            setLiveClockNowMs(now);
                            setCustomDepartureTime(formatLocalTimeRu(now));
                          }
                        }}
                        onChangeCustomDepartureTime={(hhmm) => {
                          setCustomDepartureTime(hhmm);
                          setDepartureTimeMode('custom');
                        }}
                        onChangePointA={(ep) => {
                          setPointA(ep);
                          if (ep && pointB) frameRouteEndpoints(ep, pointB);
                        }}
                        onChangePointB={(ep) => {
                          setPointB(ep);
                          if (pointA && ep) frameRouteEndpoints(pointA, ep);
                        }}
                        onSwapPoints={() => {
                          setPointA(pointB);
                          setPointB(pointA);
                        }}
                        onChangeTravelMode={setTravelMode}
                        onChangeSimVehicle={setSimVehicle}
                        onSelectTransitIdx={setSelectedTransitIdx}
                        onStartPickOnMap={(which) => {
                          setPickMode(which);
                          if (which && isMobileViewport) {
                            setMobileSheetSnap('collapsed');
                          }
                        }}
                      />
                    )}

                    {activeTab === 'explore' && (
                      <div className="flex-1 overflow-y-auto murs-scroll">
                        {/* Live Smart Search Results */}
                        {searchQuery.trim() ? (
                          <div className="px-4 py-3 murs-anim-tab">
                            <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
                              Найдено: {searchResults.length}
                            </div>
                            {searchResults.length === 0 ? (
                              <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4">
                                Ничего не найдено. Попробуйте ввести улицу и номер дома, тип здания
                                («вокзал», «библиотека», «тц», «больница», «дк») или координаты X, Z.
                              </p>
                            ) : (
                              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                                {searchResults.map((res) => (
                                  <button
                                    key={res.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedEntity(res.entity);
                                      setSearchQuery('');
                                      flyTo(res.x, res.z, 0.56);
                                      if (isMobileViewport) setMobileSheetSnap('compact');
                                    }}
                                    className="w-full text-left py-2.5 px-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800/70 transition-colors flex items-center gap-2.5"
                                  >
                                    {res.entity.type === 'station' ? (
                                      <TransitStopBadge
                                        station={res.entity.data}
                                        nearbyKinds={stationCombinedModesMap.get(res.entity.data.id)}
                                        size={22}
                                      />
                                    ) : res.badgeType === 'icon' && res.iconKind ? (
                                      <span
                                        className="px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0"
                                        style={{ backgroundColor: res.badgeColor }}
                                      >
                                        {(POI_ICON_MAP[res.iconKind] ?? POI_ICON_MAP.star).shortLabel}
                                      </span>
                                    ) : null}
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                                        {res.title}
                                      </div>
                                      <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                                        {res.subtitle}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : resolvedSelectedEntity ? (
                          <PlaceCard
                            key={
                              'data' in resolvedSelectedEntity
                                ? `${resolvedSelectedEntity.type}:${resolvedSelectedEntity.data.id}`
                                : `point:${resolvedSelectedEntity.x}_${resolvedSelectedEntity.z}`
                            }
                            entity={resolvedSelectedEntity}
                            stations={stations}
                            routes={routes}
                            onClose={() => setSelectedEntity(null)}
                            onRouteTo={(ep) => {
                              setPointB(ep);
                              setActiveTab('route');
                              if (isMobileViewport) setMobileSheetSnap('compact');
                              if (pointA) frameRouteEndpoints(pointA, ep);
                            }}
                            onRouteFrom={(ep) => {
                              setPointA(ep);
                              setActiveTab('route');
                              if (isMobileViewport) setMobileSheetSnap('compact');
                              if (pointB) frameRouteEndpoints(ep, pointB);
                            }}
                            onOpenBlueMap={(x, z) => handleOpenBlueMapAt({ x, z })}
                            onEditEntity={(ent) => {
                              setSelectedEntity(ent);
                              setEditorTool(
                                ent.type === 'station' || ent.type === 'route'
                                  ? 'move-transit'
                                  : 'select'
                              );
                              setIsEditorMode(true);
                              if (mapStyle === 'bluemap') setMapStyle('vector');
                            }}
                            onDeleteEntity={(ent) => {
                              if (ent.type === 'building') handleDeleteBuilding(ent.data.id);
                              else if (ent.type === 'street') handleDeleteStreet(ent.data.id);
                              else if (ent.type === 'land') handleDeleteLandFeature(ent.data.id);
                              else if (ent.type === 'poi') handleDeletePoi(ent.data.id);
                              else if (ent.type === 'place') handleDeletePlace(ent.data.id);
                            }}
                            onSelectStation={(st) => {
                              setSelectedEntity({ type: 'station', data: st });
                              flyTo(st.x, st.z, 0.55);
                            }}
                          />
                        ) : (
                          /* Default Explore View: Metro + Lines + Addresses Directory */
                          <div className="px-4 py-3 space-y-3 murs-anim-tab">
                            {/* Save / Load Banner when scheme is empty OR feedback notice after upload */}
                            {(saveNotice ||
                              (buildings.length === 0 &&
                                streets.length === 0 &&
                                landFeatures.length === 0 &&
                                pois.length === 0)) && (
                              <div className="p-3 rounded-xl bg-neutral-100/90 dark:bg-[#272A33] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2 text-xs murs-anim-pop">
                                {saveNotice ? (
                                  <div
                                    className={`flex items-start justify-between gap-2 font-medium ${
                                      saveNotice.ok
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-red-600 dark:text-red-400'
                                    }`}
                                  >
                                    <span>{saveNotice.text}</span>
                                    <button
                                      type="button"
                                      onClick={() => setSaveNotice(null)}
                                      aria-label="Скрыть уведомление"
                                      className="p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-white shrink-0"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <div className="font-semibold text-neutral-900 dark:text-white">
                                      Загрузите сохранение карты
                                    </div>
                                    <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                                      Базовая схема застройки не предзагружена — загрузите ваш файл{' '}
                                      <code className="font-mono text-[11px]">.json</code> или создайте
                                      объекты в редакторе.
                                    </p>
                                  </>
                                )}
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => saveFileInputRef.current?.click()}
                                    className="flex-1 h-8 px-3 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 font-bold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                                  >
                                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>Загрузить сохранение (.json)</span>
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Directory filter tabs */}
                            <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-[#282B33]">
                              {(
                                [
                                  { id: 'all', label: `Станции (${metroStationsList.length})` },
                                  { id: 'metro', label: `Линии (${routes.length})` },
                                  { id: 'addresses', label: `Адреса (${buildings.length})` },
                                ] as const
                              ).map((f) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  onClick={() => setExploreFilter(f.id)}
                                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                    exploreFilter === f.id
                                      ? 'bg-white dark:bg-[#1B1E24] text-neutral-950 dark:text-white shadow-sm'
                                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                                  }`}
                                >
                                  {f.label}
                                </button>
                              ))}
                            </div>

                            {/* Directory List */}
                            <div key={exploreFilter} className="murs-anim-tab">
                            {exploreFilter === 'all' ? (
                              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                                {metroStationsList.map((st) => (
                                  <button
                                    key={st.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedEntity({ type: 'station', data: st });
                                      flyTo(st.x, st.z, 0.56);
                                      if (isMobileViewport) setMobileSheetSnap('compact');
                                    }}
                                    className="w-full py-2.5 px-1.5 flex items-center justify-between gap-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <TransitStopBadge
                                        station={st}
                                        nearbyKinds={stationCombinedModesMap.get(st.id)}
                                        size={22}
                                      />
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                          {st.name}
                                        </div>
                                        <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                          {st.district}
                                        </div>
                                      </div>
                                    </div>
                                    <span className="text-[11px] font-mono tabular-nums text-neutral-400 shrink-0">
                                      {st.x}, {st.z}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : exploreFilter === 'metro' ? (
                              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                                {routes.slice(0, 40).map((rt) => (
                                  <button
                                    key={rt.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedEntity({ type: 'route', data: rt });
                                      const mid = rt.stops[Math.floor(rt.stops.length / 2)];
                                      if (mid) flyTo(mid.x, mid.z, 0.36);
                                      if (isMobileViewport) setMobileSheetSnap('compact');
                                    }}
                                    className="w-full py-2.5 px-1.5 flex items-center justify-between gap-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      {isMuromorskMetroRoute(rt) ? (
                                        <MuromorskMetroBadge size={22} />
                                      ) : (
                                        <span
                                          className="px-1.5 py-0.5 rounded text-[11px] font-bold text-white shrink-0"
                                          style={{ backgroundColor: rt.color }}
                                        >
                                          {rt.number}
                                        </span>
                                      )}
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                          {rt.name}
                                        </div>
                                        <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                          {getTransportLabelRu(rt.kind)} · {rt.stops.length} ост.
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : buildings.length === 0 ? (
                              <div className="p-3.5 rounded-xl bg-neutral-100/80 dark:bg-[#272A33] text-xs text-neutral-600 dark:text-neutral-300 space-y-2.5 leading-relaxed">
                                <div className="font-semibold text-neutral-900 dark:text-white">
                                  Нет загруженных зданий и адресов
                                </div>
                                <p>
                                  Загрузите готовый файл сохранения{' '}
                                  <code className="font-mono text-[11px]">.json</code> или создайте
                                  здания, дороги и территории в{' '}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsEditorMode(true);
                                      setEditorTool('synthesis');
                                    }}
                                    className="font-bold text-neutral-950 dark:text-[#FFCC00] underline"
                                  >
                                    Редакторе карты
                                  </button>
                                  .
                                </p>
                                <button
                                  type="button"
                                  onClick={() => saveFileInputRef.current?.click()}
                                  className="w-full h-8 px-3 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
                                >
                                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Загрузить сохранение (.json)</span>
                                </button>
                              </div>
                            ) : (
                              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                                {buildings.slice(0, 80).map((b) => {
                                  const bIconMeta = POI_ICON_MAP[resolveBuildingIconKind(b)];
                                  return (
                                    <button
                                      key={b.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedEntity({ type: 'building', data: b });
                                        flyTo(b.x, b.z, 0.62);
                                        if (isMobileViewport) setMobileSheetSnap('compact');
                                      }}
                                      className="w-full py-2.5 px-1.5 flex items-center justify-between gap-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors"
                                    >
                                      <div className="flex items-start gap-2.5 min-w-0">
                                        {bIconMeta ? (
                                          <span
                                            className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                                            style={{ backgroundColor: bIconMeta.color }}
                                          />
                                        ) : (
                                          <Building2
                                            className="w-4 h-4 text-neutral-400 mt-0.5 shrink-0"
                                            aria-hidden="true"
                                          />
                                        )}
                                        <div className="min-w-0">
                                          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                            {b.name}
                                          </div>
                                          <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                                            {b.street}, д. {b.houseNumber} · {b.floors} эт.
                                          </div>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                                {buildings.length > 80 && (
                                  <div className="py-2.5 px-1.5 text-xs text-neutral-500 dark:text-neutral-400 text-center">
                                    Показано 80 из {buildings.length} адресов — уточните в поиске выше
                                  </div>
                                )}
                              </div>
                            )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Persistent Save / Load Footer Bar in main sidebar */}
                  <div className="px-3.5 py-2 border-t border-neutral-200/80 dark:border-neutral-700/80 flex items-center justify-between gap-2 bg-neutral-50/70 dark:bg-[#191B21]">
                    <button
                      type="button"
                      onClick={() => saveFileInputRef.current?.click()}
                      className="flex-1 h-8 px-2.5 rounded-lg bg-neutral-200/70 hover:bg-neutral-200 dark:bg-[#2A2D36] dark:hover:bg-[#353945] text-xs font-semibold text-neutral-900 dark:text-neutral-100 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Загрузить сохранение</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportJson}
                      title="Скачать текущую схему в JSON"
                      aria-label="Скачать сохранение JSON"
                      className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-medium text-neutral-700 dark:text-neutral-300 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Сохранить</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Collapse / Expand Yandex Sidebar Handle (Desktop) */}
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? 'Свернуть панель' : 'Открыть панель'}
              className="hidden sm:flex ml-2 mt-3 w-8 h-10 rounded-xl bg-white/95 dark:bg-[#22252C]/95 border border-neutral-200/90 dark:border-neutral-700/80 shadow-md items-center justify-center text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700/70 transition-colors shrink-0"
            >
              {sidebarOpen ? (
                <ChevronLeft className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          </aside>
        );
      })()}

      {/* Desktop Re-open button when sidebar is collapsed */}
      {!photoMode && !isEditorMode && !sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Открыть панель поиска и маршрутов"
          className="hidden sm:flex fixed top-4 left-4 z-30 h-10 px-3.5 rounded-xl bg-white dark:bg-[#22252C] border border-neutral-200/90 dark:border-neutral-700/80 shadow-md items-center gap-2 text-xs font-bold text-neutral-900 dark:text-white murs-anim-slide-right"
        >
          <span
            className="w-6 h-6 rounded-md bg-sky-50/90 dark:bg-sky-950/45 border border-sky-200/80 dark:border-sky-500/25 flex items-center justify-center shrink-0 p-0.5"
            aria-hidden="true"
          >
            <img
              src="/assets/aistudio/____________8ba2e7f1.png"
              alt=""
              className="w-full h-full object-contain select-none"
              draggable={false}
            />
          </span>
          <span className="whitespace-nowrap">MURMaps</span>
          <TrainFront className="w-3.5 h-3.5 text-neutral-500" aria-hidden="true" />
        </button>
      )}

      {/* Right-Side Map Controls, Editor Launch Button, Photo Mode & Scale Bar */}
      {!photoMode && (
        <MapControls
          camera={camera}
          darkMode={darkMode}
          mapStyle={mapStyle}
          layers={layers}
          insolationEnabled={insolation.enabled}
          cursorSpanRef={cursorSpanRef}
          isEditorMode={isEditorMode}
          onEnterPhotoMode={() => setPhotoMode(true)}
          onEnterEditorMode={() => {
            setIsEditorMode(true);
            setPickMode(null);
            setEditorTool('select');
            if (mapStyle === 'bluemap') setMapStyle('vector');
          }}
          onZoomIn={() => setCamera((c) => ({ ...c, zoom: Math.min(MAX_MAP_ZOOM, c.zoom * 1.38) }))}
          onZoomOut={() => setCamera((c) => ({ ...c, zoom: Math.max(MIN_MAP_ZOOM, c.zoom / 1.38) }))}
          onToggle3D={() =>
            setCamera((c) => ({ ...c, pitch: c.pitch > 10 ? 0 : 48 }))
          }
          onResetNorth={() => setCamera((c) => ({ ...c, bearing: 0 }))}
          onRecenter={() => {
            setMapStyle('vector');
            setCamera((c) => ({
              ...c,
              x: MURS_DEFAULT_CENTER.x,
              z: MURS_DEFAULT_CENTER.z,
              zoom: 0.38,
              bearing: 0,
            }));
          }}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          onToggleInsolation={handleToggleInsolation}
          onChangeMapStyle={(style) => setMapStyle(style)}
          onToggleLayer={(key) => {
            if (key === 'insolation') {
              handleToggleInsolation();
              return;
            }
            setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
          }}
        />
      )}

      {/* Floating Astronomical Solar Insolation Panel (Kaliningrad Earth-Sun geometry) */}
      {!photoMode && insolation.enabled && (
        <InsolationControl
          insolation={insolation}
          cameraBearing={camera.bearing}
          onChange={setInsolation}
          onClose={() => {
            setInsolation((prev) => ({ ...prev, enabled: false, isPlaying: false }));
            setLayers((prev) => ({ ...prev, insolation: false }));
          }}
        />
      )}
      {/* Hidden file input for loading user JSON map saves */}
      <input
        ref={saveFileInputRef}
        type="file"
        accept=".json,application/json"
        aria-label="Загрузить файл сохранения JSON"
        onChange={handleLoadSaveFileChange}
        className="hidden"
      />
    </div>
  );
}

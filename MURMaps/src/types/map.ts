export type TransportKind =
  | 'metro'
  | 'tram'
  | 'trolleybus'
  | 'bus'
  | 'rail'
  | 'cable'
  | 'boat'
  | 'plane';

export type TravelMode = 'transit' | 'auto' | 'walk' | 'sim';

export type SimVehicleType = 'scooter' | 'bike' | 'ebike';

export type MapStyleMode = 'vector' | 'hybrid' | 'bluemap';

export type SidebarTab = 'explore' | 'route';

export type BuildingCategory =
  | 'residential'
  | 'civic'
  | 'commercial'
  | 'transport'
  | 'medical'
  | 'culture'
  | 'education'
  | 'industrial';

export type RoadClass =
  | 'highway'
  | 'avenue'
  | 'street'
  | 'lane'
  | 'service'
  | 'dirt'
  | 'embankment'
  | 'pedestrian'
  | 'railway';

export type OneWayDirection = 'none' | 'forward' | 'reverse';

export type RoofType = 'flat' | 'pitched' | 'curved' | 'complex';

export type BuildingShapeType =
  | 'rectangular'
  | 'square'
  | 'elongated'
  | 'l-shaped'
  | 'complex'
  | 'circular'
  | 'triangular'
  | 'parallelogram'
  | 'freeform';

export type SynthesisTargetMode = 'both' | 'buildings' | 'streets' | 'magic-trajectories';

export type BlockMaterialGroup = 'stone_brick' | 'concrete_asphalt' | 'wood_roof' | 'glass_metal';

export interface WorldPoint {
  x: number;
  z: number;
}

export interface WorldPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface MtrStation {
  id: string;
  name: string;
  englishName?: string;
  x: number;
  y: number;
  z: number;
  color: string;
  kinds: TransportKind[];
  routeIds: string[];
  district?: string;
}

export interface MtrRouteStop {
  stationId: string;
  name: string;
  x: number;
  y: number;
  z: number;
  dwellMs: number;
}

export interface MtrRoute {
  id: string;
  name: string;
  shortName: string;
  number: string;
  color: string;
  kind: TransportKind;
  circular: boolean;
  stops: MtrRouteStop[];
  /** Duration in milliseconds between stops[i] and stops[i+1] */
  segmentDurationsMs: number[];
  /** Average headway in seconds computed from departures or defaults */
  headwaySec: number;
  /** Optional geometry path snapped onto the traced street network */
  tracedPath?: WorldPoint[];
  /** MAGIC API 3D smoothed trace with real Minecraft server Y coordinates */
  tracedPath3D?: WorldPoint3D[];
  /** Whether the route trace was smoothed with MAGIC 3D elevation */
  magicSmoothed?: boolean;
  /** Whether the route trace was built directly from MAGIC API physical rail curves */
  magicTraced?: boolean;
  /** Number of MAGIC API physical rail segments stitched for this route */
  magicRailSegments?: number;
  /** Whether the route was snapped to real-width street corridors */
  snappedToStreets?: boolean;
  /** Percentage of route segments snapped to street corridors (0..100) */
  streetCoveragePct?: number;
  /** Parallel lane offset in blocks when sharing a street corridor */
  corridorOffset?: number;
}

export interface MagicApiStatus {
  mode: 'magic-rails-live' | 'magic-rails-imported' | 'magic-jme-3d' | 'magic-fallback';
  railsLoaded: number;
  routesTracedFromRails: number;
  totalRoutes: number;
  liveVehiclesCount: number;
  endpoint: string;
  diagnostic?: string;
}

export interface DepartureInfo {
  routeId: string;
  /** Offset milliseconds from server midnight / cycle */
  departuresMs: number[];
  deviationMs: number;
}

export interface BuildingWing {
  id: string;
  label?: string;
  x: number;
  z: number;
  footprint: WorldPoint[];
  height: number;
  floors: number;
  baseY?: number;
  roofY?: number;
  roofType?: RoofType;
  shapeType?: BuildingShapeType;
  measuredWidth?: number;
  measuredDepth?: number;
  orientationDeg?: number;
  /** Oblique shear angle in degrees (-60..60) for parallelogram wings */
  skewDeg?: number;
}

export type PoiIconKind =
  | 'station'
  | 'library'
  | 'hospital'
  | 'pharmacy'
  | 'school'
  | 'university'
  | 'museum'
  | 'theater'
  | 'shop'
  | 'cafe'
  | 'restaurant'
  | 'bank'
  | 'post'
  | 'hotel'
  | 'sport'
  | 'monument'
  | 'park'
  | 'fuel'
  | 'factory'
  | 'civic'
  | 'office'
  | 'residential'
  | 'star';

export interface MapPoi {
  id: string;
  name: string;
  icon: PoiIconKind;
  description?: string;
  x: number;
  z: number;
  y?: number;
  color?: string;
  buildingId?: string;
  isUserEdited?: boolean;
}

export type SettlementTier = 'city' | 'town' | 'village' | 'district';

export interface MapPlaceLabel {
  id: string;
  name: string;
  subtitle?: string;
  x: number;
  z: number;
  tier: SettlementTier;
  priority: number;
  isUserEdited?: boolean;
}

export interface Building3D {
  id: string;
  name: string;
  street: string;
  houseNumber: string;
  district: string;
  category: BuildingCategory;
  /** Optional custom symbol/icon for this building (e.g. station, library, cafe, monument) */
  icon?: PoiIconKind;
  /** Center point in Minecraft X, Z */
  x: number;
  z: number;
  /** Polygon footprint in Minecraft X, Z (primary wing) */
  footprint: WorldPoint[];
  /** Optional multiple architectural wings (корпуса) sharing one unified building address */
  wings?: BuildingWing[];
  /** Height in Minecraft blocks (roofY - baseY) */
  height: number;
  floors: number;
  /** Real server Minecraft ground Y coordinate (default ~67 in Муроморск) */
  baseY?: number;
  /** Real server Minecraft roof Y coordinate */
  roofY?: number;
  /** Detected architectural roof profile */
  roofType?: RoofType;
  /** Detected footprint shape classification */
  shapeType?: BuildingShapeType;
  /** Footprint fill ratio inside OBB (0..1) */
  compactness?: number;
  /** Real measured dimensions in blocks (from 3D extraction) */
  measuredWidth?: number;
  measuredDepth?: number;
  orientationDeg?: number;
  /** Oblique shear angle in degrees (-60..60) for parallelogram buildings */
  skewDeg?: number;
  roofColor?: string;
  wallColor?: string;
  description?: string;
  isUserEdited?: boolean;
  isAutoSynthesized?: boolean;
}

export interface StreetSegment {
  id: string;
  name: string;
  district: string;
  roadClass: RoadClass;
  /** Real street width in Minecraft blocks */
  width: number;
  /** Optional server Y elevation (e.g. ground 67 or elevated overpass 76) */
  elevationY?: number;
  points: WorldPoint[];
  /** Optional per-vertex 3D coordinates for sloped ramps, bridges, overpasses, and tunnels */
  points3D?: WorldPoint3D[];
  /** One-way traffic direction along polyline vertices ('forward' = start->end, 'reverse' = end->start) */
  oneWay?: OneWayDirection;
  simAllowed: boolean;
  isUserEdited?: boolean;
  isAutoSynthesized?: boolean;
}

export interface LandFeature {
  id: string;
  name: string;
  kind: 'water' | 'park' | 'square';
  polygon: WorldPoint[];
  isUserEdited?: boolean;
}

export interface StationOverride {
  x: number;
  z: number;
  y?: number;
  name?: string;
}

export interface RouteGeometryOverride {
  points: WorldPoint[];
  points3D?: WorldPoint3D[];
}

export interface MapEditsPayload {
  buildings: Building3D[];
  deletedBuildingIds: string[];
  streets: StreetSegment[];
  deletedStreetIds: string[];
  landFeatures?: LandFeature[];
  deletedLandIds?: string[];
  pois?: MapPoi[];
  deletedPoiIds?: string[];
  places?: MapPlaceLabel[];
  deletedPlaceIds?: string[];
  stationOverrides?: Record<string, StationOverride>;
  routeOverrides?: Record<string, RouteGeometryOverride>;
  updatedAt: string;
}

export interface CameraState {
  /** World X center */
  x: number;
  /** World Z center */
  z: number;
  /** Pixels per Minecraft block (0.04 to 3.2) */
  zoom: number;
  /** Pitch / tilt in degrees: 0 = 2D top-down, 52 = Yandex 3D perspective */
  pitch: number;
  /** Rotation / bearing in degrees: 0 = North up */
  bearing: number;
}

export interface MapLayerVisibility {
  buildings3D: boolean;
  mtrLines: boolean;
  liveVehicles: boolean;
  streetLabels: boolean;
  addressNumbers: boolean;
  metroOnly: boolean;
  blueMapUnderlay: boolean;
  elevation3D: boolean;
  terrainRelief: boolean;
  insolation: boolean;
}

export interface SolarInsolationState {
  enabled: boolean;
  /** Calendar date in YYYY-MM-DD (Kaliningrad local date, UTC+2) */
  dateIso: string;
  /** Local Kaliningrad time in minutes from midnight (0..1439) */
  minutesOfDay: number;
  /** Syncs automatically with real current Kaliningrad time */
  useLiveTime: boolean;
  /** Animates the sun smoothly across the day */
  isPlaying: boolean;
  /** Shadow opacity multiplier (0.2..1.0, default 0.65) */
  shadowStrength: number;
}

export interface TerrainTileData {
  tx: number;
  tz: number;
  lod: 1 | 2 | 3;
  worldX: number;
  worldZ: number;
  sizeBlocks: number;
  cols: number;
  rows: number;
  heights: Int16Array;
  minY: number;
  maxY: number;
  lightCanvas?: HTMLCanvasElement;
  darkCanvas?: HTMLCanvasElement;
}

export interface BlueMapTileImage {
  tx: number;
  tz: number;
  /** Tile LOD level (1 = 500x500 bl, 2 = 2500x2500 bl, 3 = 12500x12500 bl) */
  lod: 1 | 2 | 3;
  /** World origin in blocks */
  worldX: number;
  worldZ: number;
  sizeBlocks: number;
  image: HTMLImageElement | HTMLCanvasElement;
  terrain?: TerrainTileData;
}

export interface SynthesisStats {
  tilesScanned: number;
  tileLod: 1 | 2 | 3;
  areaBlocks: number;
  targetMode: SynthesisTargetMode;
  buildingsExtracted: number;
  buildingsRejectedNoRoof: number;
  buildingsRejectedBridges?: number;
  minBuildingHeight: number;
  maxBuildingHeight: number;
  roofBreakdown: Record<RoofType, number>;
  streetsExtracted: number;
  minStreetWidth: number;
  maxStreetWidth: number;
  avgStreetWidth: number;
  routesSnapped: number;
  totalSurfaceRoutes: number;
  avgStreetCoveragePct: number;
  elapsedMs: number;
  source: 'bluemap-live' | 'procedural-3d';
}

export interface RouteEndpoint {
  label: string;
  sublabel?: string;
  x: number;
  z: number;
  stationId?: string;
  buildingId?: string;
}

export interface RouteLeg {
  type: 'walk' | 'sim' | 'auto' | 'transit' | 'transfer';
  fromName: string;
  toName: string;
  durationSec: number;
  waitSec?: number;
  departureTimeMs?: number;
  arrivalTimeMs?: number;
  scheduledDeparture?: boolean;
  distanceBlocks: number;
  points: WorldPoint[];
  routeId?: string;
  routeNumber?: string;
  routeName?: string;
  routeColor?: string;
  transportKind?: TransportKind;
  stopsCount?: number;
  stopNames?: string[];
  instruction: string;
}

export interface ComputedRoute {
  id: string;
  mode: TravelMode;
  simVehicle?: SimVehicleType;
  totalDurationSec: number;
  departureTimeMs?: number;
  arrivalTimeMs?: number;
  totalDistanceBlocks: number;
  walkingDistanceBlocks: number;
  transfers: number;
  legs: RouteLeg[];
  summary: string;
}

export type SelectedEntity =
  | { type: 'building'; data: Building3D }
  | { type: 'station'; data: MtrStation }
  | { type: 'street'; data: StreetSegment }
  | { type: 'land'; data: LandFeature }
  | { type: 'route'; data: MtrRoute }
  | { type: 'poi'; data: MapPoi }
  | { type: 'place'; data: MapPlaceLabel }
  | { type: 'point'; x: number; z: number; label?: string };

export type MultiSelectKind = 'building' | 'street' | 'land' | 'poi' | 'place';

export interface MultiSelectedItem {
  type: MultiSelectKind;
  id: string;
}

export type EditorTool =
  | 'select'
  | 'add-building'
  | 'add-street'
  | 'add-land'
  | 'add-poi'
  | 'add-place'
  | 'move-transit'
  | 'synthesis'
  | 'delete-area';

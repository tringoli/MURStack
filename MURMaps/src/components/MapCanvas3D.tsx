import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BlueMapTileImage,
  Building3D,
  BuildingCategory,
  CameraState,
  ComputedRoute,
  DepartureInfo,
  EditorTool,
  LandFeature,
  MapLayerVisibility,
  MapPlaceLabel,
  MapPoi,
  MapStyleMode,
  MtrRoute,
  MtrStation,
  MultiSelectedItem,
  PoiIconKind,
  RoadClass,
  RouteEndpoint,
  SelectedEntity,
  SettlementTier,
  SolarInsolationState,
  StreetSegment,
  TransportKind,
  WorldPoint,
  WorldPoint3D,
} from '../types/map';
import {
  createCircleFootprint,
  createParallelogramFootprint,
  createRectFootprint,
  createTriangleFootprint,
  hitTestBuildingWithWing,
  hitTestStreet,
  screenToWorld,
  worldToScreen,
} from '../utils/projection';
import {
  buildRegionalSettlements,
  ElementAppearanceAnimator,
  getMapZoomLod,
  getPlaceHierarchyPriority,
  getStationHierarchyPriority,
  MAJOR_POI_ICONS,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  MURS_DISTRICTS,
  normalizeStationNameForDedup,
  TerritoryLabelFadeController,
  type CachedTerritoryLabel,
} from '../utils/mapZoomLod';
import {
  computeTerritoryLabelPlacement,
  getRoadHierarchyLevel,
  SERVER_GROUND_Y,
  snapBuildingRectToStreet,
  snapPointToBuildings,
  snapPointToLandFeatures,
  snapRoadPointToNetwork,
  type RoadSnappedBuildingRect,
} from '../utils/geometry';
import {
  sortBuildingRenderSlices,
  type BuildingRenderSlicePlan,
  type BuildingWallSlice,
  type SortableBuildingSlice,
} from '../utils/buildingRenderSort';
import {
  buildBuildingSpatialIndex,
  buildIconLabelCandidates,
  buildLandSpatialIndex,
  buildRouteSpatialIndex,
  buildStationSpatialIndex,
  buildStreetSpatialIndex,
  clipScreenSegmentToBox,
  computeViewportWorldBounds,
  samplePointAlongRoute3D,
  ScreenLabelGrid,
  type IndexedBuildingWing,
  type IndexedLand,
  type IndexedRoute,
  type IndexedStreet,
} from '../utils/spatialIndex';
import {
  getBuildingWings,
  insertBuildingWingVertex,
  moveBuilding,
  moveBuildingWingVertex,
  normalizeAngleDeg,
  removeBuildingWingVertex,
  resizeBuildingWingCorner,
  resizeBuildingWingHeight,
  rotateBuilding,
} from '../utils/buildingOps';
import { computePolygonArea } from '../utils/urbanSynthesizer';
import { computeActiveVehiclesOnRoute } from '../utils/scheduleSync';
import {
  buildStationCombinedModesMap,
  drawTransitStopSymbolOnCanvas,
  getTransitStopSymbolHalfExtents,
  resolveStationStopSymbol,
} from '../utils/transitStopIcons';
import {
  drawMapSymbolBadge,
  resolveBuildingIconKind,
} from '../utils/poiIcons';
import {
  AMBIENT_SOLAR_POSITION,
  computeFacadeSolarIntensity,
  computeShadowOffset,
  computeSolarPosition,
  computeWallShadowPolygons,
  computeWingShadowGeometry,
  ensureScreenPolygonCW,
  type SolarPosition,
} from '../utils/solarInsolation';

interface MapCanvas3DProps {
  camera: CameraState;
  onCameraChange: (next: CameraState) => void;
  darkMode: boolean;
  mapStyle: MapStyleMode;
  layers: MapLayerVisibility;
  insolation?: SolarInsolationState;
  isEditorMode: boolean;
  photoMode?: boolean;
  landFeatures: LandFeature[];
  blueMapTiles: BlueMapTileImage[];
  streets: StreetSegment[];
  buildings: Building3D[];
  stations: MtrStation[];
  routes: MtrRoute[];
  pois?: MapPoi[];
  places?: MapPlaceLabel[];
  departuresMap?: Map<string, DepartureInfo>;
  serverClockOffsetMs?: number;
  activeRoute: ComputedRoute | null;
  pointA: RouteEndpoint | null;
  pointB: RouteEndpoint | null;
  selectedEntity: SelectedEntity | null;
  editorTool: EditorTool;
  snapToRoad: boolean;
  snapToBuilding?: boolean;
  snapToLand?: boolean;
  synthesisPolygon: WorldPoint[];
  isSynthesisPolygonClosed: boolean;
  isSelectingSynthesisArea: boolean;
  draftStreetPoints: WorldPoint[];
  draftStreetPoints3D?: WorldPoint3D[];
  draftStreetElevationY?: number;
  draftStreetRoadClass?: RoadClass;
  draftLandPoints: WorldPoint[];
  draftLandKind?: 'park' | 'water' | 'square';
  draftBuildingPolygon?: WorldPoint[];
  draftBuildingSize: {
    width: number;
    depth: number;
    floors: number;
    angle: number;
    shape?: 'rect' | 'circle' | 'triangle' | 'parallelogram' | 'polygon';
    triangleCorner?: 0 | 1 | 2 | 3;
    skewDeg?: number;
  };
  draftPoiIcon?: PoiIconKind;
  draftPlaceTier?: SettlementTier;
  pickMode: 'A' | 'B' | null;
  activeWingId?: string | null;
  isDrawingWing?: boolean;
  mergeSourceBuildingId?: string | null;
  multiSelectedBuildingIds?: string[];
  multiSelectedItems?: MultiSelectedItem[];
  multiSelectMode?: boolean;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onSelectBuildingWithWing?: (building: Building3D, wingId: string) => void;
  onToggleMultiSelectBuilding?: (buildingId: string) => void;
  onToggleMultiSelectEntity?: (item: MultiSelectedItem) => void;
  onAddMultiSelectEntities?: (items: MultiSelectedItem[]) => void;
  onMapClickForEditor: (pt: WorldPoint & { y?: number }) => void;
  onAddBuildingPolygonPoint?: (pt: WorldPoint) => void;
  onFinishBuildingPolygon?: () => void;
  onResizeBuilding: (updated: Building3D) => void;
  onResizeStreet: (updated: StreetSegment) => void;
  onResizeLandFeature: (updated: LandFeature) => void;
  onMoveStation: (stationId: string, pos: WorldPoint) => void;
  onMovePoi?: (poiId: string, pos: WorldPoint) => void;
  onMovePlace?: (placeId: string, pos: WorldPoint) => void;
  onUpdateRoutePath: (routeId: string, points: WorldPoint[], points3D?: WorldPoint3D[]) => void;
  onCreateBuildingFromArea: (rect: RoadSnappedBuildingRect) => void;
  onAddWingFromArea?: (buildingId: string, rect: RoadSnappedBuildingRect) => void;
  onCompleteMergeBuilding?: (targetBuildingId: string) => void;
  onQuickMergeBuildings?: (sourceBuildingId: string, targetBuildingId: string) => void;
  onDeleteObjectsInArea: (minX: number, maxX: number, minZ: number, maxZ: number) => void;
  onEraseSingleObject: (target: { type: 'building' | 'street' | 'land' | 'poi'; id: string }) => void;
  onAddSynthesisVertex?: (pt: WorldPoint) => void;
  onMoveSynthesisVertex?: (vertexIdx: number, pt: WorldPoint) => void;
  onFinishSynthesisPolygon?: () => void;
  onPickRoutePoint: (which: 'A' | 'B', pt: WorldPoint) => void;
  onSetRoutePointFromContext: (which: 'A' | 'B', pt: WorldPoint) => void;
  onOpenBlueMapAt: (pt: WorldPoint) => void;
  onCursorMove?: (pt: WorldPoint) => void;
  onBeginDragEdit?: () => void;
  onEndDragEdit?: () => void;
}

const DEG_TO_RAD = Math.PI / 180;

function pointInPolygon2D(pt: WorldPoint, poly: WorldPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect =
      zi > pt.z !== zj > pt.z && pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment2D(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function rectIntersectsPolyline(
  pts: WorldPoint[],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): boolean {
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    if (pt.x >= minX && pt.x <= maxX && pt.z >= minZ && pt.z <= maxZ) return true;
  }
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const halfDiag = Math.hypot(maxX - minX, maxZ - minZ) * 0.5;
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment2D({ x: cx, z: cz }, pts[i], pts[i + 1]) <= halfDiag) {
      for (let k = 0; k <= 5; k++) {
        const f = k / 5;
        const sx = pts[i].x + (pts[i + 1].x - pts[i].x) * f;
        const sz = pts[i].z + (pts[i + 1].z - pts[i].z) * f;
        if (sx >= minX && sx <= maxX && sz >= minZ && sz <= maxZ) return true;
      }
    }
  }
  return false;
}

function getRouteControlPoints3D(route: MtrRoute): WorldPoint3D[] {
  if (route.tracedPath3D && route.tracedPath3D.length >= 2) {
    return route.tracedPath3D;
  }
  if (route.tracedPath && route.tracedPath.length >= 2) {
    const baseY = route.stops[0]?.y ?? SERVER_GROUND_Y;
    return route.tracedPath.map((p) => ({ x: p.x, y: baseY, z: p.z }));
  }
  return route.stops.map((s) => ({ x: s.x, y: s.y, z: s.z }));
}

function hitTestIndexedRoutes(
  worldPt: WorldPoint,
  candidates: IndexedRoute[],
  tolBlocks: number,
  metroOnly: boolean
): MtrRoute | null {
  let bestRoute: MtrRoute | null = null;
  let bestDist = tolBlocks;
  for (let r = 0; r < candidates.length; r++) {
    const route = candidates[r].route;
    if (metroOnly && route.kind !== 'metro') continue;
    const pts = candidates[r].offsetPts3D;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSegment2D(worldPt, pts[i], pts[i + 1]);
      if (d < bestDist) {
        bestDist = d;
        bestRoute = route;
      }
    }
  }
  return bestRoute;
}

const BUILDING_PALETTE_LIGHT: Record<
  BuildingCategory,
  { roof: string; wallA: string; wallB: string; stroke: string }
> = {
  residential: { roof: '#ECE7DA', wallA: '#DAD2C2', wallB: '#C7BEAC', stroke: '#BDB4A2' },
  civic: { roof: '#EFE2CF', wallA: '#DCC9AE', wallB: '#C8B294', stroke: '#B69E7F' },
  commercial: { roof: '#E9E3EC', wallA: '#D5CCE0', wallB: '#C1B6CE', stroke: '#AE9FBD' },
  transport: { roof: '#DCE9F3', wallA: '#C1D5E6', wallB: '#A9C2D8', stroke: '#8EACC7' },
  medical: { roof: '#F3E1E1', wallA: '#DFC7C7', wallB: '#CCB0B0', stroke: '#B89797' },
  culture: { roof: '#F2E7D2', wallA: '#DFCFAF', wallB: '#CBB893', stroke: '#B8A27A' },
  education: { roof: '#E2ECE2', wallA: '#CADAC9', wallB: '#B4C7B3', stroke: '#9BB39A' },
  industrial: { roof: '#E2E3E5', wallA: '#CECFD3', wallB: '#BABCC2', stroke: '#A4A7AE' },
};

const BUILDING_PALETTE_DARK: Record<
  BuildingCategory,
  { roof: string; wallA: string; wallB: string; stroke: string }
> = {
  residential: { roof: '#373C48', wallA: '#2D313C', wallB: '#252933', stroke: '#4A5161' },
  civic: { roof: '#443E37', wallA: '#36312B', wallB: '#2B2722', stroke: '#5B5349' },
  commercial: { roof: '#3E394A', wallA: '#322E3D', wallB: '#282431', stroke: '#554E66' },
  transport: { roof: '#313F4E', wallA: '#273340', wallB: '#1F2934', stroke: '#455A70' },
  medical: { roof: '#46373B', wallA: '#382B2F', wallB: '#2C2225', stroke: '#5E494F' },
  culture: { roof: '#453F33', wallA: '#383228', wallB: '#2D2820', stroke: '#5E5545' },
  education: { roof: '#334139', wallA: '#29352E', wallB: '#212B25', stroke: '#475C50' },
  industrial: { roof: '#363940', wallA: '#2C2E34', wallB: '#24262B', stroke: '#494D56' },
};

function drawDetailedVehicleIcon(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  headingRad: number,
  kind: TransportKind,
  color: string,
  routeNumber: string,
  zoom: number,
  isDark: boolean
) {
  const scale = Math.max(0.85, Math.min(1.35, 0.72 + zoom * 0.55));
  ctx.save();
  ctx.translate(sx, sy);

  ctx.beginPath();
  ctx.arc(0, 0, 12 * scale, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? 'rgba(20,23,29,0.88)' : 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.save();
  ctx.rotate(headingRad);
  ctx.scale(scale, scale);

  if (kind === 'plane') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(3, 1.8);
    ctx.lineTo(-1, 8.5);
    ctx.lineTo(-3.2, 8.5);
    ctx.lineTo(-1.2, 1.8);
    ctx.lineTo(-6.5, 1.5);
    ctx.lineTo(-8.5, 4.2);
    ctx.lineTo(-9.6, 4.2);
    ctx.lineTo(-8.4, 0);
    ctx.lineTo(-9.6, -4.2);
    ctx.lineTo(-8.5, -4.2);
    ctx.lineTo(-6.5, -1.5);
    ctx.lineTo(-1.2, -1.8);
    ctx.lineTo(-3.2, -8.5);
    ctx.lineTo(-1, -8.5);
    ctx.lineTo(3, -1.8);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'boat') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.quadraticCurveTo(4, 4.8, -7.5, 4.2);
    ctx.lineTo(-8.5, 0);
    ctx.lineTo(-7.5, -4.2);
    ctx.quadraticCurveTo(4, -4.8, 9, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-4.5, -2.1, 7.2, 4.2);
  } else if (kind === 'cable') {
    ctx.strokeStyle = isDark ? '#E5E7EB' : '#374151';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-5.5, -4.2, 11, 8.4, 2.5);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-3.2, -2.4, 6.4, 4.8);
  } else if (kind === 'metro' || kind === 'rail') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-9.2, -3.7, 18.4, 7.4, 3);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(4.8, -2.4, 3.1, 4.8, 1.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-0.8, -3.5);
    ctx.lineTo(-0.8, 3.5);
    ctx.stroke();
    if (kind === 'rail') {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(-6.5, -1.6, 3.8, 3.2);
    }
  } else if (kind === 'tram') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-8.2, -3.5, 16.4, 7, 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(4.8, -2.3, 2.2, 4.6);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-3.5, 0);
    ctx.lineTo(-1, -2.4);
    ctx.lineTo(1.5, 0);
    ctx.lineTo(-1, 2.4);
    ctx.closePath();
    ctx.stroke();
  } else if (kind === 'trolleybus') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-7, -3.6, 14.5, 7.2, 1.8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(4.5, -2.4, 2, 4.8);
    ctx.strokeStyle = isDark ? '#F3F4F6' : '#1F2937';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-2.5, -1.4);
    ctx.lineTo(-9.5, -2.8);
    ctx.moveTo(-2.5, 1.4);
    ctx.lineTo(-9.5, 2.8);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-7.5, -3.8, 15, 7.6, 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(4.4, -2.6, 2.1, 5.2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-3.8, -2, 4.4, 4);
  }

  ctx.restore();

  if (zoom >= 0.48 && routeNumber) {
    const tag = routeNumber.slice(0, 5);
    ctx.font = '700 9px "JetBrains Mono", monospace';
    const tw = ctx.measureText(tag).width + 6;
    const ty = 12 * scale + 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-tw / 2, ty, tw, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, 0, ty + 6.5);
  }

  ctx.restore();
}

type DragAction =
  | { active: false }
  | {
      active: true;
      mode: 'pan' | 'orbit';
      startX: number;
      startY: number;
      moved: boolean;
      startCam: CameraState;
    }
  | {
      active: true;
      mode: 'pinch';
      startDist: number;
      startAngle: number;
      startMidX: number;
      startMidY: number;
      startCam: CameraState;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'resize-building-corner';
      building: Building3D;
      wingId: string;
      cornerIdx: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'resize-building-height';
      building: Building3D;
      wingId: string;
      startY: number;
      origHeight: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'rotate-building';
      building: Building3D;
      wingId: string;
      centerX: number;
      centerZ: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-building';
      building: Building3D;
      wingId?: string;
      clickedWingId: string;
      startWorld: WorldPoint;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-building-vertex';
      building: Building3D;
      wingId: string;
      vertexIdx: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-street-vertex';
      street: StreetSegment;
      vertexIdx: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'resize-street-width';
      street: StreetSegment;
      midPoint: WorldPoint;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-land-vertex';
      feature: LandFeature;
      vertexIdx: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-station';
      station: MtrStation;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-route-vertex';
      routeId: string;
      points3D: WorldPoint3D[];
      vertexIdx: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'draw-building-area' | 'draw-wing-area' | 'delete-building-area' | 'marquee-select';
      targetBuildingId?: string;
      startWorld: WorldPoint;
      currWorld: WorldPoint;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-synthesis-vertex';
      vertexIdx: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-poi';
      poi: MapPoi;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      active: true;
      mode: 'move-place';
      place: MapPlaceLabel;
      startX: number;
      startY: number;
      moved: boolean;
    };

export const MapCanvas3D: React.FC<MapCanvas3DProps> = ({
  camera,
  onCameraChange,
  darkMode,
  mapStyle,
  layers,
  insolation,
  isEditorMode,
  photoMode = false,
  landFeatures,
  blueMapTiles,
  streets,
  buildings,
  stations,
  routes,
  pois = [],
  places = [],
  departuresMap,
  serverClockOffsetMs = 0,
  activeRoute,
  pointA,
  pointB,
  selectedEntity,
  editorTool,
  snapToRoad,
  snapToBuilding = true,
  snapToLand = true,
  synthesisPolygon,
  isSynthesisPolygonClosed,
  isSelectingSynthesisArea,
  draftStreetPoints,
  draftStreetPoints3D,
  draftStreetElevationY = SERVER_GROUND_Y,
  draftStreetRoadClass = 'street',
  draftLandPoints,
  draftLandKind = 'park',
  draftBuildingPolygon = [],
  draftBuildingSize,
  draftPoiIcon = 'star',
  draftPlaceTier = 'district',
  pickMode,
  activeWingId = null,
  isDrawingWing = false,
  mergeSourceBuildingId = null,
  multiSelectedBuildingIds = [],
  multiSelectedItems = [],
  multiSelectMode = false,
  onSelectEntity,
  onSelectBuildingWithWing,
  onToggleMultiSelectBuilding,
  onToggleMultiSelectEntity,
  onAddMultiSelectEntities,
  onMapClickForEditor,
  onAddBuildingPolygonPoint,
  onFinishBuildingPolygon,
  onResizeBuilding,
  onResizeStreet,
  onResizeLandFeature,
  onMoveStation,
  onMovePoi,
  onMovePlace,
  onUpdateRoutePath,
  onCreateBuildingFromArea,
  onAddWingFromArea,
  onCompleteMergeBuilding,
  onQuickMergeBuildings,
  onDeleteObjectsInArea,
  onEraseSingleObject,
  onAddSynthesisVertex,
  onMoveSynthesisVertex,
  onFinishSynthesisPolygon,
  onPickRoutePoint,
  onSetRoutePointFromContext,
  onOpenBlueMapAt,
  onCursorMove,
  onBeginDragEdit,
  onEndDragEdit,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const roadOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const shadowOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const groundAtlasRef = useRef<HTMLCanvasElement | null>(null);
  const labelGridRef = useRef<ScreenLabelGrid>(new ScreenLabelGrid(96, 30));
  const placeLabelGridRef = useRef<ScreenLabelGrid>(new ScreenLabelGrid(96, 30));
  const elementAnimatorRef = useRef<ElementAppearanceAnimator>(new ElementAppearanceAnimator(380, 140));
  const landLabelCtrlRef = useRef<TerritoryLabelFadeController>(
    new TerritoryLabelFadeController(150, 220, 340)
  );
  const landLabelWakeTimerRef = useRef<number | null>(null);
  const lastLandFeaturesRef = useRef<LandFeature[] | null>(null);
  const lastLandViewportRef = useRef<string>('');
  const wasAtMinZoomRef = useRef<boolean>(false);
  const wasAtMaxZoomRef = useRef<boolean>(false);

  // Precomputed spatial indices & smoothed geometries (zero per-frame sorting or smoothing!)
  const buildingIndices = useMemo(() => buildBuildingSpatialIndex(buildings), [buildings]);
  const streetIndex = useMemo(() => buildStreetSpatialIndex(streets), [streets]);
  const routeIndices = useMemo(() => buildRouteSpatialIndex(routes), [routes]);
  const stationIndices = useMemo(() => buildStationSpatialIndex(stations), [stations]);
  const stationCombinedModesMap = useMemo(() => buildStationCombinedModesMap(stations), [stations]);
  const regionalSettlements = useMemo(() => buildRegionalSettlements(stations), [stations]);
  const landIndex = useMemo(() => buildLandSpatialIndex(landFeatures), [landFeatures]);
  const orderedBlueMapTiles = useMemo(
    () => [...blueMapTiles].sort((a, b) => (b.lod ?? 1) - (a.lod ?? 1)),
    [blueMapTiles]
  );

  // Reusable query buffers (zero GC churn inside draw loop)
  const visibleLandsBuf = useRef<IndexedLand[]>([]);
  const visibleStreetsBuf = useRef<IndexedStreet[]>([]);
  const visibleRoutesBuf = useRef<IndexedRoute[]>([]);
  const visibleWingsBuf = useRef<IndexedBuildingWing[]>([]);
  const shadowWingsBuf = useRef<IndexedBuildingWing[]>([]);
  const localShadowCastersBuf = useRef<IndexedBuildingWing[]>([]);
  const visibleStationsBuf = useRef<MtrStation[]>([]);
  const hitQueryBuf = useRef<Building3D[]>([]);
  const hitStreetBuf = useRef<IndexedStreet[]>([]);
  const hitRouteBuf = useRef<IndexedRoute[]>([]);
  const hitLandBuf = useRef<IndexedLand[]>([]);
  const hitStationBuf = useRef<MtrStation[]>([]);

  // Decoupled 60fps live camera ref so panning/zooming/pinching doesn't force 60Hz React re-renders
  const liveCameraRef = useRef<CameraState>(camera);
  const lastPushedCamRef = useRef<CameraState | null>(camera);
  const lastCamSyncMsRef = useRef<number>(0);
  const isInteractingRef = useRef<boolean>(false);
  const interactionTimerRef = useRef<number | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const camAnimRef = useRef<{ rafId: number | null }>({ rafId: null });
  const wheelAnimRef = useRef<{
    rafId: number | null;
    targetZoom: number;
    anchorSx: number;
    anchorSy: number;
    anchorWorldX: number;
    anchorWorldZ: number;
    lastTs: number;
  } | null>(null);

  const cancelZoomAnims = () => {
    if (camAnimRef.current.rafId !== null) {
      window.cancelAnimationFrame(camAnimRef.current.rafId);
      camAnimRef.current.rafId = null;
    }
    if (wheelAnimRef.current?.rafId !== null && wheelAnimRef.current?.rafId !== undefined) {
      window.cancelAnimationFrame(wheelAnimRef.current.rafId);
    }
    wheelAnimRef.current = null;
  };

  const [contextMenu, setContextMenu] = useState<{
    screenX: number;
    screenY: number;
    world: WorldPoint;
  } | null>(null);

  const stateRef = useRef({
    darkMode,
    mapStyle,
    layers,
    insolation,
    isEditorMode,
    photoMode,
    landFeatures,
    blueMapTiles,
    orderedBlueMapTiles,
    streets,
    buildings,
    stations,
    routes,
    pois,
    places,
    departuresMap,
    serverClockOffsetMs,
    activeRoute,
    pointA,
    pointB,
    selectedEntity,
    editorTool,
    snapToRoad,
    snapToBuilding,
    snapToLand,
    synthesisPolygon,
    isSynthesisPolygonClosed,
    isSelectingSynthesisArea,
    draftStreetPoints,
    draftStreetPoints3D,
    draftStreetElevationY,
    draftStreetRoadClass,
    draftLandPoints,
    draftLandKind,
    draftBuildingPolygon,
    draftBuildingSize,
    draftPoiIcon,
    draftPlaceTier,
    pickMode,
    activeWingId,
    isDrawingWing,
    mergeSourceBuildingId,
    multiSelectedBuildingIds,
    multiSelectedItems,
    multiSelectMode,
    buildingIndices,
    streetIndex,
    routeIndices,
    stationIndices,
    stationCombinedModesMap,
    regionalSettlements,
    landIndex,
  });

  stateRef.current = {
    darkMode,
    mapStyle,
    layers,
    insolation,
    isEditorMode,
    photoMode,
    landFeatures,
    blueMapTiles,
    orderedBlueMapTiles,
    streets,
    buildings,
    stations,
    routes,
    pois,
    places,
    departuresMap,
    serverClockOffsetMs,
    activeRoute,
    pointA,
    pointB,
    selectedEntity,
    editorTool,
    snapToRoad,
    snapToBuilding,
    snapToLand,
    synthesisPolygon,
    isSynthesisPolygonClosed,
    isSelectingSynthesisArea,
    draftStreetPoints,
    draftStreetPoints3D,
    draftStreetElevationY,
    draftStreetRoadClass,
    draftLandPoints,
    draftLandKind,
    draftBuildingPolygon,
    draftBuildingSize,
    draftPoiIcon,
    draftPlaceTier,
    pickMode,
    activeWingId,
    isDrawingWing,
    mergeSourceBuildingId,
    multiSelectedBuildingIds,
    multiSelectedItems,
    multiSelectMode,
    buildingIndices,
    streetIndex,
    routeIndices,
    stationIndices,
    stationCombinedModesMap,
    regionalSettlements,
    landIndex,
  };

  const hoveredBuildingIdRef = useRef<string | null>(null);
  const hoveredStreetIdRef = useRef<string | null>(null);
  const hoveredLandIdRef = useRef<string | null>(null);
  const hoveredStationIdRef = useRef<string | null>(null);
  const hoveredPoiIdRef = useRef<string | null>(null);
  const hoveredPlaceIdRef = useRef<string | null>(null);
  const renderedPlaceHitsRef = useRef<
    Array<{ place: MapPlaceLabel; x1: number; y1: number; x2: number; y2: number; cx: number; cy: number }>
  >([]);
  const hoveredHandleRef = useRef<boolean>(false);
  const cursorWorldRef = useRef<WorldPoint | null>(null);
  const liveResizeBadgeRef = useRef<{ sx: number; sy: number; text: string } | null>(null);
  const snapGuideRef = useRef<[WorldPoint, WorldPoint] | null>(null);

  const dragRef = useRef<DragAction>({ active: false });

  const callbacksRef = useRef({
    onCameraChange,
    onSelectEntity,
    onSelectBuildingWithWing,
    onToggleMultiSelectBuilding,
    onToggleMultiSelectEntity,
    onAddMultiSelectEntities,
    onMapClickForEditor,
    onAddBuildingPolygonPoint,
    onFinishBuildingPolygon,
    onResizeBuilding,
    onResizeStreet,
    onResizeLandFeature,
    onMoveStation,
    onMovePoi,
    onMovePlace,
    onUpdateRoutePath,
    onCreateBuildingFromArea,
    onAddWingFromArea,
    onCompleteMergeBuilding,
    onQuickMergeBuildings,
    onDeleteObjectsInArea,
    onEraseSingleObject,
    onAddSynthesisVertex,
    onMoveSynthesisVertex,
    onFinishSynthesisPolygon,
    onPickRoutePoint,
    onCursorMove,
    onBeginDragEdit,
    onEndDragEdit,
  });
  callbacksRef.current = {
    onCameraChange,
    onSelectEntity,
    onSelectBuildingWithWing,
    onToggleMultiSelectBuilding,
    onToggleMultiSelectEntity,
    onAddMultiSelectEntities,
    onMapClickForEditor,
    onAddBuildingPolygonPoint,
    onFinishBuildingPolygon,
    onResizeBuilding,
    onResizeStreet,
    onResizeLandFeature,
    onMoveStation,
    onMovePoi,
    onMovePlace,
    onUpdateRoutePath,
    onCreateBuildingFromArea,
    onAddWingFromArea,
    onCompleteMergeBuilding,
    onQuickMergeBuildings,
    onDeleteObjectsInArea,
    onEraseSingleObject,
    onAddSynthesisVertex,
    onMoveSynthesisVertex,
    onFinishSynthesisPolygon,
    onPickRoutePoint,
    onCursorMove,
    onBeginDragEdit,
    onEndDragEdit,
  };

  const redrawRef = useRef<(() => void) | null>(null);

  // Smoothly animate external camera updates (+ / - buttons, keyboard zoom, flyTo, 2D/3D tilt, recenter)
  useEffect(() => {
    if (camera === lastPushedCamRef.current) return;
    const from: CameraState = { ...liveCameraRef.current };
    const to: CameraState = { ...camera };
    lastPushedCamRef.current = camera;

    const logFrom = Math.log(Math.max(MIN_MAP_ZOOM, from.zoom));
    const logTo = Math.log(Math.max(MIN_MAP_ZOOM, to.zoom));
    const dBearing = ((to.bearing - from.bearing + 540) % 360) - 180;
    const worldDist = Math.hypot(to.x - from.x, to.z - from.z);

    if (
      worldDist < 0.08 &&
      Math.abs(logTo - logFrom) < 0.002 &&
      Math.abs(to.pitch - from.pitch) < 0.05 &&
      Math.abs(dBearing) < 0.05
    ) {
      cancelZoomAnims();
      liveCameraRef.current = to;
      redrawRef.current?.();
      return;
    }

    cancelZoomAnims();
    const durationMs = worldDist > 600 ? 400 : worldDist > 120 ? 310 : 240;
    const startTs = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      const ease = 1 - Math.pow(1 - t, 3);
      liveCameraRef.current = {
        x: from.x + (to.x - from.x) * ease,
        z: from.z + (to.z - from.z) * ease,
        zoom: Math.exp(logFrom + (logTo - logFrom) * ease),
        pitch: from.pitch + (to.pitch - from.pitch) * ease,
        bearing: (from.bearing + dBearing * ease + 360) % 360,
      };
      redrawRef.current?.();
      if (t < 1) {
        camAnimRef.current.rafId = window.requestAnimationFrame(step);
      } else {
        camAnimRef.current.rafId = null;
        liveCameraRef.current = to;
        redrawRef.current?.();
      }
    };

    camAnimRef.current.rafId = window.requestAnimationFrame(step);
  }, [camera]);

  const pushLiveCamera = (nextCam: CameraState, immediate = false) => {
    liveCameraRef.current = nextCam;
    isInteractingRef.current = !immediate;
    redrawRef.current?.();

    const now = performance.now();
    if (immediate || now - lastCamSyncMsRef.current >= 110) {
      lastCamSyncMsRef.current = now;
      lastPushedCamRef.current = nextCam;
      callbacksRef.current.onCameraChange(nextCam);
    }

    if (interactionTimerRef.current !== null) {
      window.clearTimeout(interactionTimerRef.current);
      interactionTimerRef.current = null;
    }

    if (!immediate) {
      interactionTimerRef.current = window.setTimeout(() => {
        interactionTimerRef.current = null;
        isInteractingRef.current = false;
        const settled = liveCameraRef.current;
        if (settled !== lastPushedCamRef.current) {
          lastPushedCamRef.current = settled;
          callbacksRef.current.onCameraChange(settled);
        }
        redrawRef.current?.();
      }, 150);
    }
  };

  // Helper to get projected screen coordinates of interactive handles for currently selected object
  const getSelectedHandles = (width: number, height: number) => {
    const st = stateRef.current;
    const cam = liveCameraRef.current;
    const is3D = st.layers.buildings3D && cam.pitch > 3;
    const useElevY = st.layers.elevation3D && is3D;
    const proj = (x: number, z: number, elev = 0) => worldToScreen(x, z, elev, cam, width, height);

    if (st.selectedEntity?.type === 'building') {
      const selB = st.selectedEntity.data;
      const b = st.buildings.find((item) => item.id === selB.id) ?? selB;
      const wings = getBuildingWings(b);
      const wing = wings.find((w) => w.id === st.activeWingId) ?? wings[0];
      const baseElev = useElevY
        ? Math.max(-18, (wing.baseY ?? b.baseY ?? SERVER_GROUND_Y) - SERVER_GROUND_Y)
        : 0;
      const roofElev = is3D ? baseElev + wing.height : 0;
      const isSculptMode = wing.shapeType === 'freeform';
      const handlePts =
        wing.footprint.length > 4 || wing.shapeType === 'parallelogram'
          ? createRectFootprint(
              wing.x,
              wing.z,
              wing.measuredWidth ?? 24,
              wing.measuredDepth ?? 24,
              wing.orientationDeg ?? 0
            )
          : wing.footprint.slice(0, 4);
      const corners = handlePts.map((pt, idx) => {
        const p = proj(pt.x, pt.z, roofElev);
        return { idx, sx: p.sx, sy: p.sy };
      });
      const vertices = isSculptMode
        ? wing.footprint.map((pt, idx) => {
            const p = proj(pt.x, pt.z, roofElev);
            return { idx, sx: p.sx, sy: p.sy, worldPt: pt };
          })
        : [];
      const midpoints = isSculptMode
        ? wing.footprint.map((pt, idx) => {
            const nextPt = wing.footprint[(idx + 1) % wing.footprint.length];
            const worldPt = {
              x: (pt.x + nextPt.x) * 0.5,
              z: (pt.z + nextPt.z) * 0.5,
            };
            const p = proj(worldPt.x, worldPt.z, roofElev);
            return { afterIdx: idx, sx: p.sx, sy: p.sy, worldPt };
          })
        : [];
      const rc = proj(wing.x, wing.z, roofElev);
      const heightHandle = { sx: rc.sx, sy: rc.sy - 20 };

      // Rotation handle positioned 26px past the top edge midpoint (edge 0->1)
      let rotateAnchor = { sx: rc.sx, sy: rc.sy - 46 };
      let edgeMid = { sx: rc.sx, sy: rc.sy - 22 };
      if (corners.length >= 2) {
        const mx = (corners[0].sx + corners[1].sx) * 0.5;
        const my = (corners[0].sy + corners[1].sy) * 0.5;
        edgeMid = { sx: mx, sy: my };
        const vx = mx - rc.sx;
        const vy = my - rc.sy;
        const len = Math.hypot(vx, vy);
        if (len > 2) {
          rotateAnchor = {
            sx: mx + (vx / len) * 26,
            sy: my + (vy / len) * 26,
          };
        } else {
          rotateAnchor = { sx: mx, sy: my - 26 };
        }
      }

      return {
        kind: 'building' as const,
        building: b,
        wing,
        isSculptMode,
        corners,
        vertices,
        midpoints,
        heightHandle,
        rotateHandle: rotateAnchor,
        rotateStemFrom: edgeMid,
      };
    }

    if (st.selectedEntity?.type === 'street') {
      const selS = st.selectedEntity.data;
      const s = st.streets.find((item) => item.id === selS.id) ?? selS;
      const baseElev = useElevY
        ? Math.max(-22, Math.min(82, (s.elevationY ?? SERVER_GROUND_Y) - SERVER_GROUND_Y))
        : 0;
      const vertices = s.points.map((pt, idx) => {
        const yVal = s.points3D?.[idx]?.y ?? s.elevationY ?? SERVER_GROUND_Y;
        const vElev = useElevY ? Math.max(-22, Math.min(82, yVal - SERVER_GROUND_Y)) : 0;
        const p = proj(pt.x, pt.z, vElev);
        return { idx, sx: p.sx, sy: p.sy };
      });
      const midIdx = Math.floor((s.points.length - 1) / 2);
      const a = s.points[midIdx];
      const b = s.points[midIdx + 1] ?? a;
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const wWorld = { x: mx + nx * (s.width * 0.5 + 8), z: mz + nz * (s.width * 0.5 + 8) };
      const wp = proj(wWorld.x, wWorld.z, baseElev);
      return {
        kind: 'street' as const,
        street: s,
        vertices,
        widthHandle: { sx: wp.sx, sy: wp.sy, midPoint: { x: mx, z: mz } },
      };
    }

    if (st.selectedEntity?.type === 'land') {
      const selL = st.selectedEntity.data;
      const feat = st.landFeatures.find((item) => item.id === selL.id) ?? selL;
      const vertices = feat.polygon.map((pt, idx) => {
        const p = proj(pt.x, pt.z, 0);
        return { idx, sx: p.sx, sy: p.sy };
      });
      return { kind: 'land' as const, feature: feat, vertices };
    }

    if (st.selectedEntity?.type === 'route' && st.isEditorMode) {
      const selR = st.selectedEntity.data;
      const route = st.routes.find((item) => item.id === selR.id) ?? selR;
      const rawPts = getRouteControlPoints3D(route);
      let ctrlPts = rawPts;
      if (rawPts.length > 28) {
        const step = Math.ceil(rawPts.length / 24);
        ctrlPts = rawPts.filter((_, i) => i === 0 || i === rawPts.length - 1 || i % step === 0);
      }
      const vertices = ctrlPts.map((pt, idx) => {
        const elev = useElevY ? Math.max(-22, Math.min(82, pt.y - SERVER_GROUND_Y)) : 0;
        const p = proj(pt.x, pt.z, elev);
        return { idx, sx: p.sx, sy: p.sy };
      });
      const midpoints: Array<{ insertAfterIdx: number; sx: number; sy: number; pt3D: WorldPoint3D }> = [];
      for (let i = 0; i < ctrlPts.length - 1; i++) {
        const a = ctrlPts[i];
        const b = ctrlPts[i + 1];
        const mid3D: WorldPoint3D = {
          x: Math.round((a.x + b.x) * 0.5),
          y: Math.round((a.y + b.y) * 0.5),
          z: Math.round((a.z + b.z) * 0.5),
        };
        const elev = useElevY ? Math.max(-22, Math.min(82, mid3D.y - SERVER_GROUND_Y)) : 0;
        const p = proj(mid3D.x, mid3D.z, elev);
        if (Math.hypot(vertices[i + 1].sx - vertices[i].sx, vertices[i + 1].sy - vertices[i].sy) >= 26) {
          midpoints.push({ insertAfterIdx: i, sx: p.sx, sy: p.sy, pt3D: mid3D });
        }
      }
      return { kind: 'route' as const, route, ctrlPts, vertices, midpoints };
    }

    return null;
  };

  useEffect(() => {
    const draw = () => {
      const st = stateRef.current;
      const now = performance.now();

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const isMobile = width < 640;
      const isInteracting = isInteractingRef.current;
      const maxDpr = isInteracting ? 1.25 : isMobile ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

      const targetW = Math.floor(width * dpr);
      const targetH = Math.floor(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      const cam = liveCameraRef.current;
      const isDark = st.darkMode;
      const isHybrid = st.mapStyle === 'hybrid';
      const isSatellite = st.mapStyle === 'bluemap';
      const showBlueMapTiles =
        (isHybrid || isSatellite || st.layers.blueMapUnderlay) && st.orderedBlueMapTiles.length > 0;
      const is3D = st.layers.buildings3D && cam.pitch > 3;
      const useElevY = st.layers.elevation3D && is3D;
      const proj = (x: number, z: number, elev = 0) =>
        worldToScreen(x, z, elev, cam, width, height);

      // Compute exact viewport world AABB and semantic online-maps LOD once per frame
      const viewBounds = computeViewportWorldBounds(cam, width, height, 140);
      const lod = getMapZoomLod(cam.zoom);

      // Universal appearance animator: animates newly appearing elements & triggers wave when moving away from MIN_MAP_ZOOM or zooming out from close-up
      const elementAnimator = elementAnimatorRef.current;
      elementAnimator.beginFrame();
      if (cam.zoom <= MIN_MAP_ZOOM * 1.18) {
        wasAtMinZoomRef.current = true;
      } else if (wasAtMinZoomRef.current && cam.zoom > MIN_MAP_ZOOM * 1.18) {
        wasAtMinZoomRef.current = false;
        elementAnimator.triggerEntranceWave(now, 'route:');
      }
      if (cam.zoom >= MAX_MAP_ZOOM * 0.78) {
        wasAtMaxZoomRef.current = true;
      } else if (wasAtMaxZoomRef.current && cam.zoom < MAX_MAP_ZOOM * 0.78) {
        wasAtMaxZoomRef.current = false;
        elementAnimator.triggerEntranceWave(now, 'route:');
      }

      // Deferred candidates for strict-priority cartographic label & symbol placement (Pass 9)
      const deferredLandLabels: Array<{
        key: string;
        name: string;
        kind: LandFeature['kind'];
        sx: number;
        sy: number;
        angle: number;
        alpha: number;
        scale: number;
        isRegional: boolean;
      }> = [];

      // Territory label fade controller: smoothly dissolves labels pinned in world-space while
      // the camera is panning/zooming/tilting, keeps them hidden during motion, and gently fades
      // them back in at freshly computed interior rotated anchors after motion settles.
      const viewportKey = `${Math.round(width)}x${Math.round(height)}`;
      if (
        lastLandFeaturesRef.current !== st.landFeatures ||
        lastLandViewportRef.current !== viewportKey
      ) {
        lastLandFeaturesRef.current = st.landFeatures;
        lastLandViewportRef.current = viewportKey;
        landLabelCtrlRef.current.invalidatePlacement();
      }
      const isCameraMoving =
        isInteracting || camAnimRef.current.rafId !== null || wheelAnimRef.current !== null;
      const landLabelState = landLabelCtrlRef.current.update(cam, isCameraMoving, now);
      if (landLabelWakeTimerRef.current !== null) {
        window.clearTimeout(landLabelWakeTimerRef.current);
        landLabelWakeTimerRef.current = null;
      }
      if (landLabelState.wakeAfterMs !== null) {
        landLabelWakeTimerRef.current = window.setTimeout(() => {
          landLabelWakeTimerRef.current = null;
          redrawRef.current?.();
        }, landLabelState.wakeAfterMs);
      }
      const freshCachedLandLabels: CachedTerritoryLabel[] | null = landLabelState.shouldRecompute
        ? []
        : null;
      const deferredStreetLabels: Array<{
        key: string;
        name: string;
        roadClass: RoadClass;
        isMajor: boolean;
        mx: number;
        my: number;
        angle: number;
        alpha: number;
      }> = [];
      const deferredBuildingAnnotations: Array<{
        key: string;
        building: Building3D;
        sx: number;
        sy: number;
        roofSpanPx: number;
        isSelected: boolean;
        isHovered: boolean;
        wingAnim: number;
      }> = [];

      // 1. Background Land Canvas
      ctx.fillStyle = isSatellite
        ? '#171B22'
        : isHybrid
        ? isDark
          ? '#15181E'
          : '#D8D6CC'
        : isDark
        ? '#1D2026'
        : '#F4F2EA';
      ctx.fillRect(0, 0, width, height);

      // Subtle coordinate grid (only in clean vector schematic mode)
      if (cam.zoom >= 0.25 && !isHybrid && !isSatellite) {
        const step = cam.zoom >= 0.8 ? 100 : 250;
        const minX = Math.floor(viewBounds.minX / step) * step;
        const maxX = Math.ceil(viewBounds.maxX / step) * step;
        const minZ = Math.floor(viewBounds.minZ / step) * step;
        const maxZ = Math.ceil(viewBounds.maxZ / step) * step;

        // Guard against extreme grid line count at high pitch
        if ((maxX - minX) / step < 60 && (maxZ - minZ) / step < 60) {
          ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.035)' : 'rgba(130,122,102,0.08)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let gx = minX; gx <= maxX; gx += step) {
            const p1 = proj(gx, minZ);
            const p2 = proj(gx, maxZ);
            ctx.moveTo(p1.sx, p1.sy);
            ctx.lineTo(p2.sx, p2.sy);
          }
          for (let gz = minZ; gz <= maxZ; gz += step) {
            const p1 = proj(minX, gz);
            const p2 = proj(maxX, gz);
            ctx.moveTo(p1.sx, p1.sy);
            ctx.lineTo(p2.sx, p2.sy);
          }
          ctx.stroke();
        }
      }

      /**
       * Mathematically exact seamless BlueMap / Terrain tile ground renderer:
       * - Flat 2D (pitch <= 3): direct exact affine per visible tile (zero seam).
       * - Tilted 3D (pitch > 3): stitches all visible tiles into a single camera-aligned 2D offscreen
       *   ground atlas with 0.0px seams, then projects onto screen via exact horizontal perspective
       *   scanline strips (eliminating the diagonal triangle tilt/skew artifact completely!).
       */
      const drawGroundTiles = (
        tiles: BlueMapTileImage[],
        getSource: (
          tile: BlueMapTileImage
        ) => { img: HTMLImageElement | HTMLCanvasElement; srcW: number; srcH: number } | null,
        alpha: number
      ) => {
        if (tiles.length === 0) return;

        // Filter tiles intersecting visible frustum AABB
        const visibleTiles: Array<{
          tile: BlueMapTileImage;
          img: HTMLImageElement | HTMLCanvasElement;
          srcW: number;
          srcH: number;
        }> = [];
        for (let i = 0; i < tiles.length; i++) {
          const tile = tiles[i];
          if (
            tile.worldX + tile.sizeBlocks < viewBounds.minX ||
            tile.worldX > viewBounds.maxX ||
            tile.worldZ + tile.sizeBlocks < viewBounds.minZ ||
            tile.worldZ > viewBounds.maxZ
          ) {
            continue;
          }
          const src = getSource(tile);
          if (!src || src.srcW <= 0 || src.srcH <= 0) continue;
          visibleTiles.push({ tile, ...src });
        }
        if (visibleTiles.length === 0) return;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = isInteracting ? 'low' : 'medium';

        // Fast exact affine path for 2D mode (pitch <= 3)
        if (cam.pitch <= 3) {
          for (let i = 0; i < visibleTiles.length; i++) {
            const { tile, img, srcW, srcH } = visibleTiles[i];
            const tl = proj(tile.worldX, tile.worldZ);
            const tr = proj(tile.worldX + tile.sizeBlocks, tile.worldZ);
            const bl = proj(tile.worldX, tile.worldZ + tile.sizeBlocks);
            ctx.save();
            ctx.transform(
              (tr.sx - tl.sx) / srcW,
              (tr.sy - tl.sy) / srcW,
              (bl.sx - tl.sx) / srcH,
              (bl.sy - tl.sy) / srcH,
              tl.sx,
              tl.sy
            );
            // Tiny 0.35px bleed prevents subpixel cracks on fractional zoom/bearing
            ctx.drawImage(img, 0, 0, srcW, srcH, -0.15, -0.15, srcW + 0.35, srcH + 0.35);
            ctx.restore();
          }
          ctx.restore();
          return;
        }

        // Exact 3D horizontal scanline perspective projection via seamless offscreen atlas
        const pitchRad = Math.max(0, Math.min(60, cam.pitch)) * DEG_TO_RAD;
        const cosP = Math.cos(pitchRad);
        const sinP = Math.sin(pitchRad);
        const p = sinP * 0.00055;
        const halfH = height * 0.5;
        const halfW = width * 0.5;

        const rowMetrics = (sy: number) => {
          const offsetY = sy - halfH;
          const invDenom = Math.max(0.25, 1 + offsetY * p);
          const baseY = offsetY / invDenom;
          const scale = 1 / Math.max(0.32, 1 - baseY * p);
          const rz = baseY / Math.max(1e-6, cam.zoom * cosP);
          const halfRx = halfW / Math.max(1e-6, cam.zoom * scale);
          return { rz, halfRx };
        };

        const topM = rowMetrics(0);
        const botM = rowMetrics(height);
        const rzMin = Math.min(topM.rz, botM.rz);
        const rzMax = Math.max(topM.rz, botM.rz);
        const maxHalfRx = Math.max(topM.halfRx, botM.halfRx, 1);
        const spanX = 2 * maxHalfRx;
        const spanZ = Math.max(1, rzMax - rzMin);

        const maxDim = isInteracting ? 640 : isMobile ? 768 : 1024;
        const atlasW = Math.max(256, Math.min(maxDim, Math.ceil(width * (isInteracting ? 0.65 : 0.92))));
        const atlasH = Math.max(256, Math.min(maxDim, Math.ceil(height * (isInteracting ? 0.65 : 0.92))));

        let atlas = groundAtlasRef.current;
        if (!atlas) {
          atlas = document.createElement('canvas');
          groundAtlasRef.current = atlas;
        }
        if (atlas.width !== atlasW || atlas.height !== atlasH) {
          atlas.width = atlasW;
          atlas.height = atlasH;
        }
        const actx = atlas.getContext('2d');
        if (!actx) {
          ctx.restore();
          return;
        }

        const scaleX = atlasW / spanX;
        const scaleZ = atlasH / spanZ;

        actx.clearRect(0, 0, atlasW, atlasH);
        actx.save();
        actx.imageSmoothingEnabled = true;
        actx.imageSmoothingQuality = isInteracting ? 'low' : 'medium';
        // Single world-to-atlas affine transform guarantees 0.0px seams across all stitched tiles
        actx.scale(scaleX, scaleZ);
        actx.translate(maxHalfRx, -rzMin);
        actx.rotate(-cam.bearing * DEG_TO_RAD);
        actx.translate(-cam.x, -cam.z);

        for (let i = 0; i < visibleTiles.length; i++) {
          const { tile, img, srcW, srcH } = visibleTiles[i];
          const bleed = Math.max(0.25, tile.sizeBlocks * 0.0008);
          actx.drawImage(
            img,
            0,
            0,
            srcW,
            srcH,
            tile.worldX - bleed,
            tile.worldZ - bleed,
            tile.sizeBlocks + bleed * 2,
            tile.sizeBlocks + bleed * 2
          );
        }
        actx.restore();

        // Project offscreen ground atlas onto main canvas in exact perspective horizontal strips
        const stripH = isInteracting ? 4 : 2;
        for (let y = 0; y < height; y += stripH) {
          const yNext = Math.min(height, y + stripH);
          const yMid = (y + yNext) * 0.5;
          const m0 = rowMetrics(y);
          const m1 = rowMetrics(yNext);
          const mMid = rowMetrics(yMid);

          const rawSrcX = (maxHalfRx - mMid.halfRx) * scaleX;
          const rawSrcW = 2 * mMid.halfRx * scaleX;
          const rawSrcY = (m0.rz - rzMin) * scaleZ;
          const rawSrcH = Math.max(0.25, (m1.rz - m0.rz) * scaleZ);

          const sx0 = Math.max(0, Math.min(atlasW - 0.5, rawSrcX));
          const sw = Math.max(0.5, Math.min(atlasW - sx0, rawSrcW));
          const sy0 = Math.max(0, Math.min(atlasH - 0.5, rawSrcY));
          const sh = Math.max(0.25, Math.min(atlasH - sy0, rawSrcH));

          ctx.drawImage(atlas, sx0, sy0, sw, sh, 0, y, width, yNext - y + 0.5);
        }

        ctx.restore();
      };

      // 2. Real BlueMap Satellite Tiles
      if (showBlueMapTiles) {
        const satAlpha = isSatellite
          ? 1.0
          : isHybrid
          ? isDark
            ? 0.86
            : 0.95
          : isDark
          ? 0.55
          : 0.72;
        drawGroundTiles(
          st.orderedBlueMapTiles,
          (tile) => {
            const imgEl = tile.image;
            const srcW =
              imgEl instanceof HTMLCanvasElement
                ? imgEl.width
                : Math.min(500, imgEl.naturalWidth || 500);
            const srcH =
              imgEl instanceof HTMLCanvasElement
                ? imgEl.height
                : Math.min(500, Math.floor((imgEl.naturalHeight || 1002) / 2));
            return { img: imgEl, srcW, srcH };
          },
          satAlpha
        );
      }

      // 2a. 3D Shaded Topographic Terrain Relief Layer (only rendered when explicitly enabled)
      if (st.layers.terrainRelief && st.orderedBlueMapTiles.length > 0) {
        const reliefTiles = st.orderedBlueMapTiles.filter((t) => Boolean(t.terrain));

        if (reliefTiles.length > 0) {
          const reliefAlpha = isHybrid || isSatellite ? 0.45 : isDark ? 0.88 : 0.92;
          drawGroundTiles(
            reliefTiles,
            (tile) => {
              const relCanvas = isDark ? tile.terrain?.darkCanvas : tile.terrain?.lightCanvas;
              if (!relCanvas) return null;
              return { img: relCanvas, srcW: relCanvas.width, srcH: relCanvas.height };
            },
            reliefAlpha
          );

          // 3D vertical displaced topographic contour ribbons when tilted (skipped during fast drag for 60fps)
          if (cam.pitch > 5 && !isInteracting) {
            ctx.save();
            const elevScale = 0.72;
            for (let tIdx = 0; tIdx < reliefTiles.length; tIdx++) {
              const tile = reliefTiles[tIdx];
              if (
                tile.worldX + tile.sizeBlocks < viewBounds.minX ||
                tile.worldX > viewBounds.maxX ||
                tile.worldZ + tile.sizeBlocks < viewBounds.minZ ||
                tile.worldZ > viewBounds.maxZ
              ) {
                continue;
              }
              const terrain = tile.terrain!;
              const { cols, rows, heights, worldX, worldZ, sizeBlocks } = terrain;
              const stride = Math.max(5, Math.round(cols / 12));
              const stepX = sizeBlocks / cols;
              const stepZ = sizeBlocks / rows;

              ctx.lineWidth = 1;
              ctx.strokeStyle = isDark ? 'rgba(203, 213, 225, 0.20)' : 'rgba(92, 74, 52, 0.22)';
              ctx.beginPath();
              for (let r = 0; r < rows; r += stride) {
                let started = false;
                for (let c = 0; c < cols; c += 2) {
                  const y = heights[r * cols + c];
                  const relY = Math.max(-18, Math.min(80, (y - SERVER_GROUND_Y) * elevScale));
                  const p = proj(worldX + (c + 0.5) * stepX, worldZ + (r + 0.5) * stepZ, relY);
                  if (!started) {
                    ctx.moveTo(p.sx, p.sy);
                    started = true;
                  } else {
                    ctx.lineTo(p.sx, p.sy);
                  }
                }
              }
              for (let c = 0; c < cols; c += stride) {
                let started = false;
                for (let r = 0; r < rows; r += 2) {
                  const y = heights[r * cols + c];
                  const relY = Math.max(-18, Math.min(80, (y - SERVER_GROUND_Y) * elevScale));
                  const p = proj(worldX + (c + 0.5) * stepX, worldZ + (r + 0.5) * stepZ, relY);
                  if (!started) {
                    ctx.moveTo(p.sx, p.sy);
                    started = true;
                  } else {
                    ctx.lineTo(p.sx, p.sy);
                  }
                }
              }
              ctx.stroke();

              if (cam.zoom >= 0.26 && terrain.maxY - terrain.minY >= 6) {
                let peakR = 0;
                let peakC = 0;
                let peakY = -9999;
                for (let r = 4; r < rows - 4; r += 4) {
                  for (let c = 4; c < cols - 4; c += 4) {
                    const y = heights[r * cols + c];
                    if (y > peakY) {
                      peakY = y;
                      peakR = r;
                      peakC = c;
                    }
                  }
                }
                if (peakY > SERVER_GROUND_Y + 4) {
                  const wx = worldX + (peakC + 0.5) * stepX;
                  const wz = worldZ + (peakR + 0.5) * stepZ;
                  const relY = Math.max(-18, Math.min(80, (peakY - SERVER_GROUND_Y) * elevScale));
                  const pp = proj(wx, wz, relY);
                  if (pp.sx > 24 && pp.sx < width - 24 && pp.sy > 24 && pp.sy < height - 24) {
                    ctx.fillStyle = isDark ? 'rgba(226,232,240,0.85)' : 'rgba(92,66,38,0.85)';
                    ctx.beginPath();
                    ctx.arc(pp.sx, pp.sy, 2.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.font = '600 10px "JetBrains Mono", monospace';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.lineWidth = 2.6;
                    ctx.strokeStyle = isDark ? 'rgba(20,23,29,0.85)' : 'rgba(255,255,255,0.85)';
                    const hLabel = `${peakY} м`;
                    ctx.strokeText(hLabel, pp.sx + 5, pp.sy);
                    ctx.fillText(hLabel, pp.sx + 5, pp.sy);
                  }
                }
              }
            }
            ctx.restore();
          }
        }
      }

      // Derive fast lookup sets for multi-selection across all entity types
      const multiSelectedBuildingSet = new Set<string>(st.multiSelectedBuildingIds);
      const multiSelectedStreetSet = new Set<string>();
      const multiSelectedLandSet = new Set<string>();
      const multiSelectedPoiSet = new Set<string>();
      const multiSelectedPlaceSet = new Set<string>();
      for (let mi = 0; mi < st.multiSelectedItems.length; mi++) {
        const item = st.multiSelectedItems[mi];
        if (item.type === 'building') multiSelectedBuildingSet.add(item.id);
        else if (item.type === 'street') multiSelectedStreetSet.add(item.id);
        else if (item.type === 'land') multiSelectedLandSet.add(item.id);
        else if (item.type === 'poi') multiSelectedPoiSet.add(item.id);
        else if (item.type === 'place') multiSelectedPlaceSet.add(item.id);
      }

      // 2b. Water, Parks & Squares (spatially culled via landIndex; seamless joins for same-type territories)
      const selectedLandId =
        st.selectedEntity?.type === 'land' ? st.selectedEntity.data.id : null;
      const hoveredLandId = hoveredLandIdRef.current;
      const visibleLands = st.landIndex.queryAABB(viewBounds, visibleLandsBuf.current);

      const projectedLandPolys: Array<Array<{ sx: number; sy: number }>> = new Array(
        visibleLands.length
      );
      const landAnims: number[] = new Array(visibleLands.length);
      for (let li = 0; li < visibleLands.length; li++) {
        const feat = visibleLands[li].feature;
        const isSel = feat.id === selectedLandId;
        landAnims[li] = elementAnimator.getProgress(`land:${feat.id}`, now, isSel);
        const pts: Array<{ sx: number; sy: number }> = new Array(feat.polygon.length);
        for (let idx = 0; idx < feat.polygon.length; idx++) {
          pts[idx] = proj(feat.polygon[idx].x, feat.polygon[idx].z);
        }
        projectedLandPolys[li] = pts;
      }

      const landKindOrder: Array<LandFeature['kind']> = ['park', 'square', 'water'];
      const getLandStyle = (kind: LandFeature['kind']) => {
        if (kind === 'water') {
          return {
            fill: showBlueMapTiles
              ? isDark
                ? 'rgba(24,42,61,0.32)'
                : 'rgba(165,211,243,0.30)'
              : isDark
              ? '#182A3D'
              : '#A5D3F3',
            border: isDark ? '#233D57' : '#85BCE4',
            borderW: 1.5,
            isOpaque: !showBlueMapTiles,
          };
        }
        if (kind === 'park') {
          return {
            fill: showBlueMapTiles
              ? isDark
                ? 'rgba(34,51,40,0.24)'
                : 'rgba(207,230,184,0.24)'
              : isDark
              ? '#223328'
              : '#CFE6B8',
            border: isDark ? '#2C4234' : '#B7D59C',
            borderW: 1,
            isOpaque: !showBlueMapTiles,
          };
        }
        return {
          fill: isDark ? 'rgba(72,72,82,0.35)' : 'rgba(231,226,210,0.65)',
          border: isDark ? '#4B5563' : '#C8C1AE',
          borderW: 1,
          isOpaque: false,
        };
      };

      const traceProjectedPoly = (pts: Array<{ sx: number; sy: number }>) => {
        for (let idx = 0; idx < pts.length; idx++) {
          if (idx === 0) ctx.moveTo(pts[idx].sx, pts[idx].sy);
          else ctx.lineTo(pts[idx].sx, pts[idx].sy);
        }
        ctx.closePath();
      };

      for (let ki = 0; ki < landKindOrder.length; ki++) {
        const kind = landKindOrder[ki];
        const style = getLandStyle(kind);

        // Pass A: Unified fill for all steady-state territories of this kind
        // (CW winding + single nonzero fill avoids double-alpha seams & subpixel cracks!)
        if (!isHybrid) {
          let hasUnified = false;
          let hasNeighborsInUnified = false;
          ctx.save();
          ctx.beginPath();
          for (let li = 0; li < visibleLands.length; li++) {
            const item = visibleLands[li];
            if (item.feature.kind !== kind) continue;
            const isEraserHoverLand =
              st.editorTool === 'delete-area' && item.feature.id === hoveredLandId;
            if (isEraserHoverLand || landAnims[li] < 0.995) continue;
            const cwPts = ensureScreenPolygonCW(projectedLandPolys[li]);
            if (cwPts.length < 3) continue;
            traceProjectedPoly(cwPts);
            hasUnified = true;
            if (item.hasSameKindNeighbor) hasNeighborsInUnified = true;
          }
          if (hasUnified) {
            ctx.fillStyle = style.fill;
            ctx.fill('nonzero');
            if (style.isOpaque && hasNeighborsInUnified) {
              // Sub-pixel seam seal on opaque fills so rotated flush joins have 0.0px hairline gaps
              ctx.strokeStyle = style.fill;
              ctx.lineWidth = 0.9;
              ctx.lineJoin = 'round';
              ctx.stroke();
            }
          }
          ctx.restore();

          // Individual fills for territories currently fading in
          for (let li = 0; li < visibleLands.length; li++) {
            const item = visibleLands[li];
            if (item.feature.kind !== kind) continue;
            const isEraserHoverLand =
              st.editorTool === 'delete-area' && item.feature.id === hoveredLandId;
            if (isEraserHoverLand || landAnims[li] >= 0.995) continue;
            ctx.save();
            ctx.globalAlpha = landAnims[li];
            ctx.beginPath();
            traceProjectedPoly(projectedLandPolys[li]);
            ctx.fillStyle = style.fill;
            ctx.fill();
            ctx.restore();
          }

          // Pass B: Seamless exterior-only borders (hide shared/internal edges between same-type territories)
          ctx.save();
          ctx.strokeStyle = style.border;
          ctx.lineWidth = style.borderW;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (let li = 0; li < visibleLands.length; li++) {
            const item = visibleLands[li];
            if (item.feature.kind !== kind) continue;
            const feat = item.feature;
            const isSelectedLand = feat.id === selectedLandId;
            const isMultiSelectedLand = multiSelectedLandSet.has(feat.id);
            const isEraserHoverLand = st.editorTool === 'delete-area' && feat.id === hoveredLandId;
            if (isSelectedLand || isMultiSelectedLand || isEraserHoverLand) continue;
            const edges = item.exposedBorderEdges;
            if (edges.length === 0) continue;
            if (landAnims[li] < 0.995) {
              ctx.save();
              ctx.globalAlpha = landAnims[li];
              ctx.beginPath();
              for (let ei = 0; ei < edges.length; ei++) {
                const pa = proj(edges[ei].a.x, edges[ei].a.z);
                const pb = proj(edges[ei].b.x, edges[ei].b.z);
                ctx.moveTo(pa.sx, pa.sy);
                ctx.lineTo(pb.sx, pb.sy);
              }
              ctx.stroke();
              ctx.restore();
            } else {
              ctx.beginPath();
              for (let ei = 0; ei < edges.length; ei++) {
                const pa = proj(edges[ei].a.x, edges[ei].a.z);
                const pb = proj(edges[ei].b.x, edges[ei].b.z);
                ctx.moveTo(pa.sx, pa.sy);
                ctx.lineTo(pb.sx, pb.sy);
              }
              ctx.stroke();
            }
          }
          ctx.restore();
        }

        // Pass C: Interactive highlight overlays (selected, multi-selected, eraser hover — also visible in Hybrid)
        for (let li = 0; li < visibleLands.length; li++) {
          const item = visibleLands[li];
          if (item.feature.kind !== kind) continue;
          const feat = item.feature;
          const isSelectedLand = feat.id === selectedLandId;
          const isMultiSelectedLand = multiSelectedLandSet.has(feat.id);
          const isEraserHoverLand = st.editorTool === 'delete-area' && feat.id === hoveredLandId;
          if (!isSelectedLand && !isMultiSelectedLand && !isEraserHoverLand) continue;

          ctx.save();
          if (landAnims[li] < 0.995) ctx.globalAlpha = landAnims[li];
          ctx.beginPath();
          traceProjectedPoly(projectedLandPolys[li]);
          if (isEraserHoverLand) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
            ctx.fill();
            ctx.strokeStyle = '#DC2626';
            ctx.lineWidth = 2.4;
            ctx.stroke();
          } else {
            if (isHybrid) {
              ctx.fillStyle = style.fill;
              ctx.fill();
            }
            if (isMultiSelectedLand) {
              ctx.fillStyle = 'rgba(2, 132, 199, 0.16)';
              ctx.fill();
            }
            ctx.strokeStyle = isMultiSelectedLand ? '#0284C7' : '#FC3F1D';
            ctx.lineWidth = 2.6;
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      for (let li = 0; li < visibleLands.length; li++) {
        const { feature: feat } = visibleLands[li];
        const screenPoly = projectedLandPolys[li].map((p) => ({ x: p.sx, y: p.sy }));
        const landSpan = Math.max(
          visibleLands[li].aabb.maxX - visibleLands[li].aabb.minX,
          visibleLands[li].aabb.maxZ - visibleLands[li].aabb.minZ
        );
        const landLabelAlpha =
          landSpan >= 160 ? lod.opacity.landLabels : lod.opacity.minorLandLabels;
        if (freshCachedLandLabels && landLabelAlpha > 0.02 && feat.name) {
          const isRegionalLand = lod.tier === 'regional';
          const measureFont =
            feat.kind === 'water'
              ? `italic 600 ${isRegionalLand ? 12 : 11}px Manrope, sans-serif`
              : '600 10.5px Manrope, sans-serif';
          ctx.font = measureFont;
          const labelW = ctx.measureText(feat.name).width;
          const placement = computeTerritoryLabelPlacement(
            screenPoly,
            width,
            height,
            labelW,
            isRegionalLand ? 14 : 13
          );
          if (placement) {
            const worldAnchor = screenToWorld(placement.sx, placement.sy, cam, width, height);
            freshCachedLandLabels.push({
              key: `land-lbl:${feat.id}`,
              name: feat.name,
              kind: feat.kind,
              worldX: worldAnchor.x,
              worldZ: worldAnchor.z,
              angle: placement.angle,
              baseAlpha: landLabelAlpha,
              isRegional: isRegionalLand,
            });
            if (landLabelState.opacity > 0.01) {
              deferredLandLabels.push({
                key: `land-lbl:${feat.id}`,
                name: feat.name,
                kind: feat.kind,
                sx: placement.sx,
                sy: placement.sy,
                angle: placement.angle,
                alpha: landLabelAlpha * landLabelState.opacity,
                scale: landLabelState.scale,
                isRegional: isRegionalLand,
              });
            }
          }
        }
      }

      if (freshCachedLandLabels) {
        landLabelCtrlRef.current.setCachedLabels(freshCachedLandLabels);
      } else if (landLabelState.phase !== 'hidden' && landLabelState.opacity > 0.01) {
        const cached = landLabelCtrlRef.current.getCachedLabels();
        for (let ci = 0; ci < cached.length; ci++) {
          const cl = cached[ci];
          const sp = proj(cl.worldX, cl.worldZ, 0);
          if (sp.sx < -160 || sp.sx > width + 160 || sp.sy < -80 || sp.sy > height + 80) {
            continue;
          }
          deferredLandLabels.push({
            key: cl.key,
            name: cl.name,
            kind: cl.kind,
            sx: sp.sx,
            sy: sp.sy,
            angle: cl.angle,
            alpha: cl.baseAlpha * landLabelState.opacity,
            scale: landLabelState.scale,
            isRegional: cl.isRegional,
          });
        }
      }

      // 3. Hierarchical Streets & Railway Tracks — Zero-Opacity-Stacking Cartographic Pipeline
      // Draws ALL road casings below ALL road fills per elevation tier (composited once in Hybrid mode!)
      // so intersecting road nodes never stack transparency or show circular joint artifacts.
      const selectedStreetId =
        st.selectedEntity?.type === 'street' ? st.selectedEntity.data.id : null;
      const visibleStreets = st.streetIndex.queryAABB(viewBounds, visibleStreetsBuf.current);
      const useCoarseStreets = isInteracting || cam.zoom < 0.22;

      const getRoadFillHex = (rc: RoadClass): string => {
        switch (rc) {
          case 'highway':
            return isDark ? '#B35D1C' : '#FF9B42';
          case 'avenue':
            return isDark ? '#474030' : '#FFE68A';
          case 'embankment':
            return isDark ? '#2E3642' : '#FFF7D6';
          case 'street':
            return isDark ? '#2B303A' : '#FFFFFF';
          case 'lane':
            return isDark ? '#282D37' : '#FAFAF8';
          case 'service':
            return isDark ? '#242933' : '#F1F3F6';
          case 'dirt':
            return isDark ? '#4A3E2F' : '#E7D3B1';
          case 'railway':
            return isDark ? '#94A3B8' : '#334155';
          case 'pedestrian':
            return isDark ? '#555B68' : '#C2BAAA';
        }
      };

      const getRoadCasingHex = (rc: RoadClass): string => {
        switch (rc) {
          case 'highway':
            return isDark ? '#7C3A0B' : '#D97724';
          case 'avenue':
            return isDark ? '#5E5438' : '#DFC163';
          case 'embankment':
            return isDark ? '#3F4856' : '#DFCFA0';
          case 'street':
          case 'lane':
            return isDark ? '#3A404D' : '#D4CFC2';
          case 'service':
            return isDark ? '#373D4A' : '#CFD5DF';
          case 'dirt':
            return isDark ? '#6D5A43' : '#C2A476';
          case 'railway':
            return isDark ? '#323846' : '#94A3B8';
          case 'pedestrian':
            return isDark ? '#555B68' : '#C2BAAA';
        }
      };

      // Group visible streets by discrete elevation tier (tunnels < ground < bridges/overpasses)
      const elevTiers = new Map<number, IndexedStreet[]>();
      for (let i = 0; i < visibleStreets.length; i++) {
        const idxStreet = visibleStreets[i];
        const rc = idxStreet.street.roadClass;
        if (lod.opacity.roadClassAlpha(rc) <= 0.02) {
          continue;
        }
        const tierKey = Math.round((idxStreet.elevY - SERVER_GROUND_Y) / 4);
        let tier = elevTiers.get(tierKey);
        if (!tier) {
          tier = [];
          elevTiers.set(tierKey, tier);
        }
        tier.push(idxStreet);
      }

      const sortedTierKeys = Array.from(elevTiers.keys()).sort((a, b) => a - b);

      // In Hybrid mode, draw opaque road passes to a reusable offscreen layer and composite ONCE
      // so overlapping road joints NEVER darken via alpha stacking!
      let roadCtx: CanvasRenderingContext2D = ctx;
      let usingRoadOffscreen = false;
      if (isHybrid && sortedTierKeys.length > 0) {
        let off = roadOffscreenRef.current;
        if (!off) {
          off = document.createElement('canvas');
          roadOffscreenRef.current = off;
        }
        const targetW = Math.max(1, Math.round(width * dpr));
        const targetH = Math.max(1, Math.round(height * dpr));
        if (off.width !== targetW || off.height !== targetH) {
          off.width = targetW;
          off.height = targetH;
        }
        const octx = off.getContext('2d');
        if (octx) {
          octx.setTransform(dpr, 0, 0, dpr, 0, 0);
          octx.clearRect(0, 0, width, height);
          roadCtx = octx;
          usingRoadOffscreen = true;
        }
      }

      const traceStreetPath = (
        targetCtx: CanvasRenderingContext2D,
        pts3D: WorldPoint3D[]
      ): boolean => {
        targetCtx.beginPath();
        if (pts3D.length < 2) return false;
        const pad = 64;
        const minX = -pad;
        const minY = -pad;
        const maxX = width + pad;
        const maxY = height + pad;
        let hasSegment = false;
        let prevEOff = useElevY ? Math.max(-22, Math.min(82, pts3D[0].y - SERVER_GROUND_Y)) : 0;
        let prevP = proj(pts3D[0].x, pts3D[0].z, prevEOff);
        let lastX = NaN;
        let lastY = NaN;
        for (let j = 1; j < pts3D.length; j++) {
          const eOff = useElevY ? Math.max(-22, Math.min(82, pts3D[j].y - SERVER_GROUND_Y)) : 0;
          const p = proj(pts3D[j].x, pts3D[j].z, eOff);
          const clipped = clipScreenSegmentToBox(
            prevP.sx,
            prevP.sy,
            p.sx,
            p.sy,
            minX,
            minY,
            maxX,
            maxY
          );
          if (clipped) {
            if (
              !hasSegment ||
              Math.abs(clipped.ax - lastX) > 0.25 ||
              Math.abs(clipped.ay - lastY) > 0.25
            ) {
              targetCtx.moveTo(clipped.ax, clipped.ay);
            }
            targetCtx.lineTo(clipped.bx, clipped.by);
            lastX = clipped.bx;
            lastY = clipped.by;
            hasSegment = true;
          }
          prevP = p;
        }
        return hasSegment;
      };

      for (let tk = 0; tk < sortedTierKeys.length; tk++) {
        const tierKey = sortedTierKeys[tk];
        const tierItems = elevTiers.get(tierKey)!;
        // Sort ascending by road hierarchy so higher-priority fills overlay lower-priority fills seamlessly
        tierItems.sort((a, b) => a.sortKey - b.sortKey);

        // Pass 0: Bridge drop shadows & support pylons (elevated tiers only)
        if (useElevY && tierKey > 0 && !isInteracting) {
          for (let i = 0; i < tierItems.length; i++) {
            const item = tierItems[i];
            if (item.maxElevY <= SERVER_GROUND_Y + 2.5) continue;
            const pts3D = useCoarseStreets ? item.coarsePoints3D : item.smoothedPoints3D;
            const pxW = Math.max(2.6, item.street.width * cam.zoom * 0.92);

            roadCtx.save();
            roadCtx.beginPath();
            for (let j = 0; j < pts3D.length; j++) {
              const p = proj(pts3D[j].x, pts3D[j].z, 0);
              if (j === 0) roadCtx.moveTo(p.sx, p.sy);
              else roadCtx.lineTo(p.sx, p.sy);
            }
            roadCtx.lineCap = 'round';
            roadCtx.lineJoin = 'round';
            roadCtx.strokeStyle = 'rgba(0,0,0,0.24)';
            roadCtx.lineWidth = pxW + 4;
            roadCtx.stroke();

            roadCtx.strokeStyle = isDark ? 'rgba(148,163,184,0.42)' : 'rgba(71,85,105,0.34)';
            roadCtx.lineWidth = Math.max(1.4, Math.min(3.5, cam.zoom * 2.5));
            roadCtx.beginPath();
            const step = Math.max(2, Math.floor(pts3D.length / 7));
            for (let j = 0; j < pts3D.length; j += step) {
              const eOff = Math.max(-22, Math.min(82, pts3D[j].y - SERVER_GROUND_Y));
              if (eOff <= 2.5) continue;
              const gp = proj(pts3D[j].x, pts3D[j].z, 0);
              const tp = proj(pts3D[j].x, pts3D[j].z, eOff);
              roadCtx.moveTo(gp.sx, gp.sy);
              roadCtx.lineTo(tp.sx, tp.sy);
            }
            roadCtx.stroke();
            roadCtx.restore();
          }
        }

        // Pass 1: ALL Road Casings (100% opaque — drawn strictly BELOW all fills so joints merge seamlessly!)
        for (let i = 0; i < tierItems.length; i++) {
          const item = tierItems[i];
          const street = item.street;
          const pts3D = useCoarseStreets ? item.coarsePoints3D : item.smoothedPoints3D;
          const pxW = Math.max(2.4, street.width * cam.zoom * 0.92);
          const isTunnel = item.minElevY < SERVER_GROUND_Y - 1.5;
          const isSel = street.id === selectedStreetId;
          const isMultiSel = multiSelectedStreetSet.has(street.id);
          const isEraserHover =
            st.editorTool === 'delete-area' && street.id === hoveredStreetIdRef.current;
          const streetAnim = elementAnimator.getProgress(
            `street:${street.id}`,
            now,
            isSel || isMultiSel || isEraserHover
          );
          const roadAlpha =
            (isSel || isMultiSel || isEraserHover ? 1 : lod.opacity.roadClassAlpha(street.roadClass)) *
            streetAnim;
          if (roadAlpha <= 0.01) continue;

          roadCtx.save();
          if (roadAlpha < 0.995) roadCtx.globalAlpha = roadAlpha;
          roadCtx.lineCap = 'round';
          roadCtx.lineJoin = 'round';
          if (isTunnel) roadCtx.setLineDash([8, 5]);
          if (!traceStreetPath(roadCtx, pts3D)) {
            roadCtx.restore();
            continue;
          }

          if (street.roadClass === 'pedestrian') {
            roadCtx.setLineDash([4, 4]);
            roadCtx.strokeStyle = isEraserHover
              ? '#DC2626'
              : isMultiSel
              ? '#0284C7'
              : isSel
              ? '#FC3F1D'
              : getRoadCasingHex('pedestrian');
            roadCtx.lineWidth = Math.max(2, pxW + (isEraserHover || isSel || isMultiSel ? 2 : 0));
            roadCtx.stroke();
          } else if (street.roadClass === 'railway') {
            roadCtx.strokeStyle = isEraserHover
              ? '#DC2626'
              : isMultiSel
              ? '#0284C7'
              : isSel
              ? '#FC3F1D'
              : getRoadCasingHex('railway');
            roadCtx.lineWidth = Math.max(
              4.5,
              pxW + (isEraserHover || isSel || isMultiSel ? 4 : 2.6)
            );
            roadCtx.stroke();
          } else {
            roadCtx.strokeStyle = isEraserHover
              ? '#DC2626'
              : isMultiSel
              ? '#0284C7'
              : isSel
              ? '#FC3F1D'
              : getRoadCasingHex(street.roadClass);
            roadCtx.lineWidth =
              pxW +
              (isEraserHover
                ? 4.6
                : isSel || isMultiSel
                ? 4.0
                : street.roadClass === 'highway'
                ? 3.2
                : street.roadClass === 'service' || street.roadClass === 'dirt'
                ? 1.9
                : 2.4);
            roadCtx.stroke();
          }
          roadCtx.restore();
        }

        // Pass 2: ALL Road Inner Fills (100% opaque — zero joint circles or casing seams across intersections!)
        for (let i = 0; i < tierItems.length; i++) {
          const item = tierItems[i];
          const street = item.street;
          if (street.roadClass === 'pedestrian') continue;
          const pts3D = useCoarseStreets ? item.coarsePoints3D : item.smoothedPoints3D;
          const isRegionalScale = lod.tier === 'regional';
          const pxW = isRegionalScale
            ? street.roadClass === 'highway'
              ? 2.4
              : street.roadClass === 'railway'
              ? 2.0
              : 1.5
            : Math.max(1.8, street.width * cam.zoom * 0.92);
          const isTunnel = item.minElevY < SERVER_GROUND_Y - 1.5;
          const isSelFill = street.id === selectedStreetId || multiSelectedStreetSet.has(street.id);
          const streetFillAnim = elementAnimator.getProgress(`street:${street.id}`, now, isSelFill);
          const roadAlpha =
            (isSelFill ? 1 : lod.opacity.roadClassAlpha(street.roadClass)) * streetFillAnim;
          if (roadAlpha <= 0.01) continue;

          roadCtx.save();
          if (roadAlpha < 0.995) roadCtx.globalAlpha = roadAlpha;
          roadCtx.lineCap = 'round';
          roadCtx.lineJoin = 'round';
          if (!traceStreetPath(roadCtx, pts3D)) {
            roadCtx.restore();
            continue;
          }

          if (street.roadClass === 'railway') {
            roadCtx.strokeStyle = getRoadFillHex('railway');
            roadCtx.lineWidth = isRegionalScale ? 2.0 : Math.max(2.2, pxW * 0.62);
            roadCtx.stroke();
            roadCtx.strokeStyle = isDark ? '#E2E8F0' : '#F8FAFC';
            roadCtx.lineWidth = isRegionalScale ? 1.1 : Math.max(1.4, pxW * 0.36);
            roadCtx.setLineDash(isRegionalScale ? [3, 4] : [4, 5]);
            roadCtx.stroke();
            roadCtx.restore();
            continue;
          }

          if (isTunnel) roadCtx.setLineDash([8, 4]);
          roadCtx.strokeStyle = getRoadFillHex(street.roadClass);
          roadCtx.lineWidth = pxW;
          roadCtx.stroke();

          roadCtx.restore();
        }

        // Pass 3: Smooth Style Transitions where different road classes meet at a shared endpoint
        if (cam.zoom >= 0.26 && !isInteracting && tierItems.length > 1) {
          interface EndpointStub {
            street: StreetSegment;
            pts3D: WorldPoint3D[];
            isStart: boolean;
            pt: WorldPoint3D;
          }
          const stubBuckets = new Map<string, EndpointStub[]>();
          for (let i = 0; i < tierItems.length; i++) {
            const s = tierItems[i].street;
            if (s.roadClass === 'pedestrian' || s.roadClass === 'railway') continue;
            const pts3D = tierItems[i].smoothedPoints3D;
            if (pts3D.length < 2) continue;
            const ends: Array<{ isStart: boolean; pt: WorldPoint3D }> = [
              { isStart: true, pt: pts3D[0] },
              { isStart: false, pt: pts3D[pts3D.length - 1] },
            ];
            for (const end of ends) {
              const key = `${Math.round(end.pt.x / 5)},${Math.round(end.pt.z / 5)}`;
              let arr = stubBuckets.get(key);
              if (!arr) {
                arr = [];
                stubBuckets.set(key, arr);
              }
              arr.push({ street: s, pts3D, isStart: end.isStart, pt: end.pt });
            }
          }

          stubBuckets.forEach((stubs) => {
            if (stubs.length < 2) return;
            // Pick highest-class road at this junction as blend anchor
            let topStub = stubs[0];
            for (let i = 1; i < stubs.length; i++) {
              if (
                getRoadHierarchyLevel(stubs[i].street.roadClass) >
                getRoadHierarchyLevel(topStub.street.roadClass)
              ) {
                topStub = stubs[i];
              }
            }
            const topColor = getRoadFillHex(topStub.street.roadClass);

            for (let i = 0; i < stubs.length; i++) {
              const stub = stubs[i];
              if (stub.street.roadClass === topStub.street.roadClass) continue;
              if (Math.hypot(stub.pt.x - topStub.pt.x, stub.pt.z - topStub.pt.z) > 6.5) continue;

              // Walk ~20 blocks along the lower-class connecting road to build a smooth color gradient blend
              const blendDist = Math.min(24, Math.max(10, stub.street.width * 1.4));
              const seq = stub.isStart ? stub.pts3D : [...stub.pts3D].reverse();
              const blendPts: WorldPoint3D[] = [seq[0]];
              let acc = 0;
              for (let j = 1; j < seq.length && acc < blendDist; j++) {
                const segD = Math.hypot(seq[j].x - seq[j - 1].x, seq[j].z - seq[j - 1].z);
                if (acc + segD >= blendDist && segD > 0.1) {
                  const f = (blendDist - acc) / segD;
                  blendPts.push({
                    x: seq[j - 1].x + (seq[j].x - seq[j - 1].x) * f,
                    y: seq[j - 1].y + (seq[j].y - seq[j - 1].y) * f,
                    z: seq[j - 1].z + (seq[j].z - seq[j - 1].z) * f,
                  });
                  break;
                }
                blendPts.push(seq[j]);
                acc += segD;
              }
              if (blendPts.length < 2) continue;

              const p0 = proj(
                blendPts[0].x,
                blendPts[0].z,
                useElevY ? Math.max(-22, Math.min(82, blendPts[0].y - SERVER_GROUND_Y)) : 0
              );
              const pEnd = proj(
                blendPts[blendPts.length - 1].x,
                blendPts[blendPts.length - 1].z,
                useElevY
                  ? Math.max(-22, Math.min(82, blendPts[blendPts.length - 1].y - SERVER_GROUND_Y))
                  : 0
              );
              if (Math.hypot(pEnd.sx - p0.sx, pEnd.sy - p0.sy) < 4) continue;

              const grad = roadCtx.createLinearGradient(p0.sx, p0.sy, pEnd.sx, pEnd.sy);
              grad.addColorStop(0, topColor);
              grad.addColorStop(1, getRoadFillHex(stub.street.roadClass));

              roadCtx.save();
              roadCtx.lineCap = 'round';
              roadCtx.lineJoin = 'round';
              traceStreetPath(roadCtx, blendPts);
              roadCtx.strokeStyle = grad;
              roadCtx.lineWidth = Math.max(1.8, stub.street.width * cam.zoom * 0.92);
              roadCtx.stroke();
              roadCtx.restore();
            }
          });
        }

        // Pass 4: Crisp One-Way Directional Arrows on one-way road segments
        if (lod.opacity.oneWayArrows > 0.02) {
          for (let i = 0; i < tierItems.length; i++) {
            const item = tierItems[i];
            const street = item.street;
            if (!street.oneWay || street.oneWay === 'none') continue;
            if (street.roadClass === 'railway' || street.roadClass === 'pedestrian') continue;

            const arrowAlpha = Math.min(
              lod.opacity.oneWayArrows,
              lod.opacity.roadClassAlpha(street.roadClass)
            );
            if (arrowAlpha <= 0.02) continue;

            const pts3D = useCoarseStreets ? item.coarsePoints3D : item.smoothedPoints3D;
            if (pts3D.length < 2) continue;
            const pxW = Math.max(2, street.width * cam.zoom * 0.92);
            const isMicro = lod.tier === 'micro';
            const arrowSize = isMicro
              ? Math.max(5.2, Math.min(9.2, pxW * 0.46))
              : Math.max(4.0, Math.min(7.5, pxW * 0.42));
            const spacingPx = isMicro ? 78 : 68;
            const dirSign = street.oneWay === 'reverse' ? -1 : 1;

            // Project polyline and sample evenly in screen space
            const screenPts: Array<{ sx: number; sy: number }> = [];
            for (let j = 0; j < pts3D.length; j++) {
              const eOff = useElevY ? Math.max(-22, Math.min(82, pts3D[j].y - SERVER_GROUND_Y)) : 0;
              const p = proj(pts3D[j].x, pts3D[j].z, eOff);
              screenPts.push({ sx: p.sx, sy: p.sy });
            }

            let distSinceArrow = spacingPx * 0.45;
            const isSelOrMulti =
              street.id === selectedStreetId || multiSelectedStreetSet.has(street.id);
            const arrowColor = isSelOrMulti
              ? '#0284C7'
              : street.roadClass === 'highway'
              ? isDark
                ? '#FEF3C7'
                : '#7C2D12'
              : isDark
              ? '#93C5FD'
              : '#1D4ED8';

            roadCtx.save();
            roadCtx.globalAlpha = arrowAlpha;
            roadCtx.strokeStyle = arrowColor;
            roadCtx.fillStyle = arrowColor;
            roadCtx.lineWidth = Math.max(1.4, Math.min(2.1, arrowSize * 0.3));
            roadCtx.lineCap = 'round';
            roadCtx.lineJoin = 'round';

            for (let j = 0; j < screenPts.length - 1; j++) {
              const a = screenPts[j];
              const b = screenPts[j + 1];
              const segLen = Math.hypot(b.sx - a.sx, b.sy - a.sy);
              if (segLen < 1) continue;
              let cursor = spacingPx - distSinceArrow;
              while (cursor <= segLen) {
                const frac = cursor / segLen;
                const ax = a.sx + (b.sx - a.sx) * frac;
                const ay = a.sy + (b.sy - a.sy) * frac;
                if (ax >= -20 && ax <= width + 20 && ay >= -20 && ay <= height + 20) {
                  let ang = Math.atan2(b.sy - a.sy, b.sx - a.sx);
                  if (dirSign < 0) ang += Math.PI;
                  roadCtx.save();
                  roadCtx.translate(ax, ay);
                  roadCtx.rotate(ang);
                  // Crisp arrow shaft + chevron head
                  roadCtx.beginPath();
                  roadCtx.moveTo(-arrowSize * 0.95, 0);
                  roadCtx.lineTo(arrowSize * 0.75, 0);
                  roadCtx.moveTo(arrowSize * 0.15, -arrowSize * 0.56);
                  roadCtx.lineTo(arrowSize * 0.85, 0);
                  roadCtx.lineTo(arrowSize * 0.15, arrowSize * 0.56);
                  roadCtx.stroke();
                  roadCtx.restore();
                }
                cursor += spacingPx;
              }
              distSinceArrow = (distSinceArrow + segLen) % spacingPx;
            }
            roadCtx.restore();
          }
        }
      }

      // Composite offscreen hybrid road canvas once at uniform opacity (zero joint darkening!)
      if (usingRoadOffscreen && roadOffscreenRef.current) {
        ctx.save();
        ctx.globalAlpha = 0.82;
        ctx.drawImage(roadOffscreenRef.current, 0, 0, width, height);
        ctx.restore();
      }

      // 4. Collect Street & Highway Name Labels for strict-priority Pass 9 placement
      if (st.layers.streetLabels && lod.opacity.streetLabels > 0.02 && !isInteracting) {
        for (let i = 0; i < visibleStreets.length; i++) {
          const item = visibleStreets[i];
          const street = item.street;
          if (street.points.length < 2 || !street.name) continue;
          const isMajorRoad =
            street.roadClass === 'highway' ||
            street.roadClass === 'avenue' ||
            street.roadClass === 'embankment' ||
            street.roadClass === 'railway';
          const labelAlpha = isMajorRoad
            ? lod.opacity.streetLabels
            : lod.opacity.minorStreetLabels;
          if (labelAlpha <= 0.02) continue;
          if (street.isAutoSynthesized && cam.zoom < 0.48) continue;
          const elevOffset = useElevY ? Math.max(-10, item.elevY - SERVER_GROUND_Y) : 0;
          const a = proj(street.points[item.midIdx].x, street.points[item.midIdx].z, elevOffset);
          const b = proj(
            street.points[item.midIdx + 1].x,
            street.points[item.midIdx + 1].z,
            elevOffset
          );
          const segPx = Math.hypot(b.sx - a.sx, b.sy - a.sy);
          if (segPx < 60) continue;

          const mx = (a.sx + b.sx) * 0.5;
          const my = (a.sy + b.sy) * 0.5;
          if (mx < -60 || mx > width + 60 || my < -30 || my > height + 30) continue;

          let angle = Math.atan2(b.sy - a.sy, b.sx - a.sx);
          if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;

          deferredStreetLabels.push({
            key: `street-lbl:${street.id}`,
            name: street.name,
            roadClass: street.roadClass,
            isMajor: isMajorRoad,
            mx,
            my,
            angle,
            alpha: labelAlpha,
          });
        }
      }

      // 5. Public Transit Lines (spatially culled + precomputed 3D lane offsets)
      const visibleRoutes = st.layers.mtrLines
        ? st.routeIndices.routeIndex.queryAABB(viewBounds, visibleRoutesBuf.current)
        : [];
      if (visibleRoutes.length > 1) {
        visibleRoutes.sort((a, b) => a.rank - b.rank);
      }

      if (st.layers.mtrLines) {
        // Keep full smoothed route geometry at all city/quarter/micro zooms; only simplify at macro regional scale
        const useCoarseRoutes = cam.zoom < 0.08;
        const routeClipPad = 64;
        const rMinX = -routeClipPad;
        const rMinY = -routeClipPad;
        const rMaxX = width + routeClipPad;
        const rMaxY = height + routeClipPad;

        const traceClippedRoutePath = (pts3D: WorldPoint3D[], forceGround = false): boolean => {
          ctx.beginPath();
          if (pts3D.length < 2) return false;
          let hasSegment = false;
          const firstElev =
            !forceGround && useElevY ? Math.max(-22, Math.min(82, pts3D[0].y - SERVER_GROUND_Y)) : 0;
          let prevP = proj(pts3D[0].x, pts3D[0].z, firstElev);
          let lastX = NaN;
          let lastY = NaN;
          for (let i = 1; i < pts3D.length; i++) {
            const elev =
              !forceGround && useElevY
                ? Math.max(-22, Math.min(82, pts3D[i].y - SERVER_GROUND_Y))
                : 0;
            const p = proj(pts3D[i].x, pts3D[i].z, elev);
            const clipped = clipScreenSegmentToBox(
              prevP.sx,
              prevP.sy,
              p.sx,
              p.sy,
              rMinX,
              rMinY,
              rMaxX,
              rMaxY
            );
            if (clipped) {
              if (
                !hasSegment ||
                Math.abs(clipped.ax - lastX) > 0.25 ||
                Math.abs(clipped.ay - lastY) > 0.25
              ) {
                ctx.moveTo(clipped.ax, clipped.ay);
              }
              ctx.lineTo(clipped.bx, clipped.by);
              lastX = clipped.bx;
              lastY = clipped.by;
              hasSegment = true;
            }
            prevP = p;
          }
          return hasSegment;
        };

        for (let r = 0; r < visibleRoutes.length; r++) {
          const item = visibleRoutes[r];
          const route = item.route;
          if (st.layers.metroOnly && route.kind !== 'metro') continue;

          const isMetro = route.kind === 'metro';
          const isTram = route.kind === 'tram';
          const isRail = route.kind === 'rail';
          const isCable = route.kind === 'cable';
          const isBoat = route.kind === 'boat';
          const isPlane = route.kind === 'plane';
          const isMajorTransit = isMetro || isRail || isCable || isBoat || isPlane;
          const isSelectedRoute =
            st.selectedEntity?.type === 'route' && st.selectedEntity.data.id === route.id;
          const routeAnim = elementAnimator.getProgress(`route:${route.id}`, now, isSelectedRoute);
          const transitFadeAlpha = (isMajorTransit ? 1 : lod.opacity.surfaceTransit) * routeAnim;
          if (transitFadeAlpha <= 0.02) {
            continue;
          }

          const pts = useCoarseRoutes ? item.coarsePts3D : item.offsetPts3D;
          const isUnderground = useElevY && item.avgY < SERVER_GROUND_Y - 7;
          const isElevated = useElevY && item.avgY > SERVER_GROUND_Y + 5;

          if (isElevated && !isPlane && !isInteracting) {
            if (traceClippedRoutePath(pts, true)) {
              ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.35)' : 'rgba(30,41,59,0.16)';
              ctx.lineWidth = 2.2;
              ctx.stroke();
            }

            ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.38)' : 'rgba(71,85,105,0.32)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            const pylonStep = Math.max(2, Math.floor(pts.length / 8));
            for (let i = 0; i < pts.length; i += pylonStep) {
              const elev = Math.max(-22, Math.min(82, pts[i].y - SERVER_GROUND_Y));
              if (elev < 5) continue;
              const gp = proj(pts[i].x, pts[i].z, 0);
              if (gp.sx < rMinX || gp.sx > rMaxX || gp.sy < rMinY || gp.sy > rMaxY) continue;
              const tp = proj(pts[i].x, pts[i].z, elev);
              ctx.moveTo(gp.sx, gp.sy);
              ctx.lineTo(tp.sx, tp.sy);
            }
            ctx.stroke();
          }

          if (!traceClippedRoutePath(pts, false)) continue;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (isSelectedRoute) {
            ctx.save();
            ctx.strokeStyle = '#FFCC00';
            ctx.lineWidth = Math.max(9, cam.zoom * 12 + 5);
            ctx.stroke();
            ctx.strokeStyle = route.color;
            ctx.lineWidth = Math.max(4.5, cam.zoom * 7 + 2.5);
            ctx.stroke();
            ctx.restore();
          } else if (isMetro) {
            ctx.save();
            ctx.globalAlpha = (isUnderground ? 0.72 : 1) * routeAnim;
            if (isUnderground) {
              ctx.setLineDash([10, 5]);
            }
            ctx.strokeStyle = isDark ? 'rgba(20,22,28,0.85)' : 'rgba(255,255,255,0.92)';
            ctx.lineWidth = Math.max(5, Math.min(8, cam.zoom * 10 + 3));
            ctx.stroke();
            ctx.strokeStyle = route.color;
            ctx.lineWidth = Math.max(3, Math.min(5.5, cam.zoom * 7 + 1.8));
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.save();
            ctx.strokeStyle = route.color;
            const baseLineAlpha = route.snappedToStreets
              ? isTram || isCable
                ? 0.88
                : 0.72
              : isTram || isCable
              ? 0.68
              : isRail || isBoat
              ? 0.62
              : 0.42;
            ctx.globalAlpha = baseLineAlpha * transitFadeAlpha;
            ctx.lineWidth =
              lod.tier === 'regional' && isRail
                ? 2.2
                : route.snappedToStreets
                ? isTram
                  ? 2.8
                  : 2.2
                : isCable
                ? 2.6
                : isRail
                ? 2.4
                : 1.7;
            if (isRail || isBoat || isPlane) ctx.setLineDash(isPlane ? [4, 6] : [7, 4]);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 6. 3D Extruded Multi-Wing Buildings (Spatially Culled + Backface-Culled Walls + Zoom LOD + Solar Insolation)
      const palette = isDark ? BUILDING_PALETTE_DARK : BUILDING_PALETTE_LIGHT;
      const selectedBldgId =
        st.selectedEntity?.type === 'building' ? st.selectedEntity.data.id : null;
      const hoveredBldgId = hoveredBuildingIdRef.current;

      const buildingAlpha = lod.opacity.buildings;
      const visibleWings =
        buildingAlpha > 0.02
          ? st.buildingIndices.wingIndex.queryAABB(viewBounds, visibleWingsBuf.current)
          : [];

      // Zoom-based LOD & smooth 3D wall extrusion rise/sink
      const denseScene = visibleWings.length > (isMobile ? 280 : 650);
      const extrudeFactor = lod.opacity.buildingExtrusion;
      const extrudeBuildings = is3D && extrudeFactor > 0.02 && !(isInteracting && denseScene);
      const minSpanPx = denseScene ? 3.5 : 1.0;

      // Pass 5.5: Unified Offscreen Ground Shadows (Solar Insolation OR Physically Consistent Ambient 3D Shadows)
      // Rendering ALL ground shadows into a single solid offscreen mask BEFORE Pass 6 buildings guarantees:
      // 1) Zero double-darkening when nearby buildings' shadows overlap
      // 2) Zero Canvas winding-cancellation holes (via ensureScreenPolygonCW)
      // 3) Ground shadows never paint on top of neighboring buildings' roofs or walls
      // 4) Full environment awareness: water-surface attenuation, elevated skybridge offsets, underground culling,
      //    and unified roof-on-roof / wall-on-wall occlusion in Pass 6.
      const insolationState = st.insolation;
      const insolationActive = Boolean(insolationState?.enabled);
      const solarPos: SolarPosition | null = insolationActive
        ? computeSolarPosition(insolationState!.dateIso, insolationState!.minutesOfDay)
        : null;

      let shadowWings: IndexedBuildingWing[] = [];
      const renderSolarGroundShadows =
        insolationActive && solarPos !== null && buildingAlpha > 0.02 && solarPos.shadowOpacity > 0.01;
      const renderAmbientGroundShadows =
        !insolationActive &&
        extrudeBuildings &&
        buildingAlpha > 0.02 &&
        !isHybrid &&
        !denseScene &&
        visibleWings.length > 0;

      const activeShadowSolar: SolarPosition | null = renderSolarGroundShadows
        ? solarPos
        : renderAmbientGroundShadows
        ? AMBIENT_SOLAR_POSITION
        : null;

      if (activeShadowSolar) {
        // Expand query AABB upwind toward the light source so tall buildings just outside the viewport still cast shadows in!
        const reach = Math.min(480, 120 * activeShadowSolar.shadowLengthPerBlock + 40);
        const shadowQueryBounds = {
          minX: viewBounds.minX - Math.max(20, activeShadowSolar.shadowDir.x * reach),
          maxX: viewBounds.maxX + Math.max(20, -activeShadowSolar.shadowDir.x * reach),
          minZ: viewBounds.minZ - Math.max(20, activeShadowSolar.shadowDir.z * reach),
          maxZ: viewBounds.maxZ + Math.max(20, -activeShadowSolar.shadowDir.z * reach),
        };
        shadowWings = st.buildingIndices.wingIndex.queryAABB(
          shadowQueryBounds,
          shadowWingsBuf.current
        );
      }

      const groundShadowCasters = activeShadowSolar ? shadowWings : [];

      if (activeShadowSolar && groundShadowCasters.length > 0) {
        let shadowCanvas = shadowOffscreenRef.current;
        if (!shadowCanvas) {
          shadowCanvas = document.createElement('canvas');
          shadowOffscreenRef.current = shadowCanvas;
        }
        const targetW = Math.max(1, Math.round(width * dpr));
        const targetH = Math.max(1, Math.round(height * dpr));
        if (shadowCanvas.width !== targetW || shadowCanvas.height !== targetH) {
          shadowCanvas.width = targetW;
          shadowCanvas.height = targetH;
        }
        const sCtx = shadowCanvas.getContext('2d');
        if (sCtx) {
          sCtx.setTransform(1, 0, 0, 1, 0, 0);
          sCtx.clearRect(0, 0, targetW, targetH);
          sCtx.scale(dpr, dpr);

          sCtx.fillStyle = renderSolarGroundShadows && solarPos
            ? isDark
              ? '#020617'
              : solarPos.goldenHourFactor > 0.35
              ? '#1E1B4B'
              : '#0F172A'
            : isDark
            ? '#020617'
            : '#2A2721';

          const shadowDense = groundShadowCasters.length > (isMobile ? 320 : 800);
          const shadowMinSpanPx = shadowDense ? 3.0 : renderSolarGroundShadows ? 0.8 : 1.8;

          sCtx.beginPath();
          for (let i = 0; i < groundShadowCasters.length; i++) {
            const sw = groundShadowCasters[i];
            if (sw.maxSpan * cam.zoom < shadowMinSpanPx) continue;
            const wing = sw.wing;
            const fp = wing.footprint;
            const nPts = fp.length;
            if (nPts < 3) continue;

            const rawBaseY = wing.baseY ?? sw.building.baseY ?? SERVER_GROUND_Y;
            // Underground / buried wings never cast shadows onto ground above them
            if (useElevY && rawBaseY + wing.height <= SERVER_GROUND_Y + 0.15) continue;

            const isSelCaster =
              sw.building.id === selectedBldgId || multiSelectedBuildingSet.has(sw.building.id);
            const casterAnim = elementAnimator.getProgress(`bldg:${sw.building.id}`, now, isSelCaster);
            const heightScale = renderSolarGroundShadows
              ? (is3D ? extrudeFactor : 1) * casterAnim
              : extrudeFactor * casterAnim;

            const baseAboveGround = useElevY ? Math.max(0, rawBaseY - SERVER_GROUND_Y) : 0;
            const effectiveH = Math.max(0, wing.height * heightScale);
            const topAboveGround = baseAboveGround + effectiveH;
            if (topAboveGround <= 0.25) continue;

            const baseOff =
              baseAboveGround > 0.2
                ? computeShadowOffset(baseAboveGround, activeShadowSolar)
                : { dx: 0, dz: 0 };
            const roofOff = computeShadowOffset(topAboveGround, activeShadowSolar);
            if (Math.hypot(roofOff.dx - baseOff.dx, roofOff.dz - baseOff.dz) < 0.2) continue;

            const bScreen: Array<{ sx: number; sy: number }> = new Array(nPts);
            const sScreen: Array<{ sx: number; sy: number }> = new Array(nPts);
            let minSx = Infinity;
            let maxSx = -Infinity;
            let minSy = Infinity;
            let maxSy = -Infinity;
            for (let k = 0; k < nPts; k++) {
              const bp = proj(fp[k].x + baseOff.dx, fp[k].z + baseOff.dz, 0);
              const sp = proj(fp[k].x + roofOff.dx, fp[k].z + roofOff.dz, 0);
              bScreen[k] = bp;
              sScreen[k] = sp;
              if (bp.sx < minSx) minSx = bp.sx;
              if (bp.sx > maxSx) maxSx = bp.sx;
              if (sp.sx < minSx) minSx = sp.sx;
              if (sp.sx > maxSx) maxSx = sp.sx;
              if (bp.sy < minSy) minSy = bp.sy;
              if (bp.sy > maxSy) maxSy = bp.sy;
              if (sp.sy < minSy) minSy = sp.sy;
              if (sp.sy > maxSy) maxSy = sp.sy;
            }
            if (maxSx < -40 || minSx > width + 40 || maxSy < -40 || minSy > height + 40) {
              continue;
            }

            // Normalize every subpath to CW winding so overlapping shadows NEVER cancel out!
            const sCw = ensureScreenPolygonCW(sScreen);
            sCtx.moveTo(sCw[0].sx, sCw[0].sy);
            for (let k = 1; k < nPts; k++) {
              sCtx.lineTo(sCw[k].sx, sCw[k].sy);
            }
            sCtx.closePath();

            const bCw = ensureScreenPolygonCW(bScreen);
            sCtx.moveTo(bCw[0].sx, bCw[0].sy);
            for (let k = 1; k < nPts; k++) {
              sCtx.lineTo(bCw[k].sx, bCw[k].sy);
            }
            sCtx.closePath();

            for (let k = 0; k < nPts; k++) {
              const nxt = (k + 1) % nPts;
              const quadCw = ensureScreenPolygonCW([
                bScreen[k],
                bScreen[nxt],
                sScreen[nxt],
                sScreen[k],
              ]);
              sCtx.moveTo(quadCw[0].sx, quadCw[0].sy);
              sCtx.lineTo(quadCw[1].sx, quadCw[1].sy);
              sCtx.lineTo(quadCw[2].sx, quadCw[2].sy);
              sCtx.lineTo(quadCw[3].sx, quadCw[3].sy);
              sCtx.closePath();
            }
          }
          sCtx.fill();

          // Environment awareness: softly attenuate ground shadows over water bodies (rivers/lakes reflect ambient sky light)
          let hasWater = false;
          for (let li = 0; li < visibleLands.length; li++) {
            if (visibleLands[li].feature.kind === 'water' && visibleLands[li].feature.polygon.length >= 3) {
              hasWater = true;
              break;
            }
          }
          if (hasWater) {
            sCtx.save();
            sCtx.globalCompositeOperation = 'destination-out';
            sCtx.fillStyle = 'rgba(0, 0, 0, 0.44)';
            sCtx.beginPath();
            for (let li = 0; li < visibleLands.length; li++) {
              const feat = visibleLands[li].feature;
              if (feat.kind !== 'water' || feat.polygon.length < 3) continue;
              const wPts = ensureScreenPolygonCW(feat.polygon.map((pt) => proj(pt.x, pt.z, 0)));
              sCtx.moveTo(wPts[0].sx, wPts[0].sy);
              for (let k = 1; k < wPts.length; k++) {
                sCtx.lineTo(wPts[k].sx, wPts[k].sy);
              }
              sCtx.closePath();
            }
            sCtx.fill();
            sCtx.restore();
          }

          // In Hybrid mode buildings are semi-transparent; punch out ground-level footprints so shadows don't bleed through roofs
          if (isHybrid) {
            sCtx.save();
            sCtx.globalCompositeOperation = 'destination-out';
            sCtx.fillStyle = '#000000';
            sCtx.beginPath();
            for (let i = 0; i < visibleWings.length; i++) {
              const vw = visibleWings[i];
              const fp = vw.wing.footprint;
              if (fp.length < 3) continue;
              const basePts = ensureScreenPolygonCW(fp.map((pt) => proj(pt.x, pt.z, 0)));
              sCtx.moveTo(basePts[0].sx, basePts[0].sy);
              for (let k = 1; k < basePts.length; k++) {
                sCtx.lineTo(basePts[k].sx, basePts[k].sy);
              }
              sCtx.closePath();
            }
            sCtx.fill();
            sCtx.restore();
          }

          const unifiedAlpha = renderSolarGroundShadows && solarPos
            ? Math.max(
                0,
                Math.min(
                  0.78,
                  solarPos.shadowOpacity *
                    insolationState!.shadowStrength *
                    (isDark ? 0.56 : 0.44) *
                    buildingAlpha
                )
              )
            : (isDark ? 0.30 : 0.16) * buildingAlpha * extrudeFactor;

          if (unifiedAlpha > 0.008) {
            ctx.save();
            ctx.globalAlpha = unifiedAlpha;
            ctx.drawImage(shadowCanvas, 0, 0, width, height);
            ctx.restore();
          }
        }
      }

      interface DrawSlicePayload {
        item: IndexedBuildingWing;
        slice: BuildingRenderSlicePlan;
        rawBaseY: number;
        baseElev: number;
        wingExtrude: boolean;
        effExtrude: number;
        bldgAnim: number;
        isSelected: boolean;
        isMultiSelected: boolean;
        isActiveWing: boolean;
        isHovered: boolean;
        isMergeCandidate: boolean;
        depthHint: number;
        topYHint: number;
      }

      const multiSelectedSet = multiSelectedBuildingSet;
      const sortableSlices: SortableBuildingSlice<DrawSlicePayload>[] = [];

      for (let i = 0; i < visibleWings.length; i++) {
        const item = visibleWings[i];
        const b = item.building;
        const wing = item.wing;
        const fpLen = wing.footprint.length;
        if (fpLen < 3) continue;

        const isSelected = b.id === selectedBldgId;
        const isMultiSelected = multiSelectedSet.has(b.id);
        if (!isSelected && !isMultiSelected && item.maxSpan * cam.zoom < minSpanPx) continue;

        const pCenter = proj(wing.x, wing.z, 0);
        const verticalMargin = Math.max(220, wing.height * cam.zoom + 140);
        if (
          pCenter.sx < -260 ||
          pCenter.sx > width + 260 ||
          pCenter.sy < -260 ||
          pCenter.sy > height + verticalMargin
        ) {
          continue;
        }

        const isActiveWing = isSelected && (!st.activeWingId || wing.id === st.activeWingId);
        const isHovered = b.id === hoveredBldgId;
        const isMergeCandidate =
          Boolean(st.mergeSourceBuildingId) &&
          st.mergeSourceBuildingId !== b.id &&
          isHovered;

        const bldgAnim = elementAnimator.getProgress(
          `bldg:${b.id}`,
          now,
          isSelected || isMultiSelected
        );
        const rawBaseY = wing.baseY ?? b.baseY ?? SERVER_GROUND_Y;
        const baseElev = useElevY ? Math.max(-18, rawBaseY - SERVER_GROUND_Y) : 0;
        const wingExtrude =
          extrudeBuildings && (isSelected || isMultiSelected || item.maxSpan * cam.zoom >= 2.2);
        const effExtrude = extrudeFactor * bldgAnim;
        const topYHint = rawBaseY + wing.height;

        const slices: BuildingRenderSlicePlan[] =
          item.renderSlices && item.renderSlices.length > 0
            ? item.renderSlices
            : [
                {
                  minY: rawBaseY,
                  maxY: topYHint,
                  drawRoof: true,
                  wallSlices: item.exposedWallEdges.map((e) => ({
                    a: e.a,
                    b: e.b,
                    outNx: e.outNx,
                    outNz: e.outNz,
                    minY: rawBaseY,
                    maxY: topYHint,
                  })),
                  sortPoly: wing.footprint,
                  aabb: item.aabb,
                },
              ];

        for (let sIdx = 0; sIdx < slices.length; sIdx++) {
          const slice = slices[sIdx];
          // In flat 2D mode, only the topmost roof slice needs rendering
          if (!wingExtrude && !slice.drawRoof) continue;

          const sliceMinElev = wingExtrude ? baseElev + (slice.minY - rawBaseY) * effExtrude : 0;
          const sliceMaxElev = wingExtrude ? baseElev + (slice.maxY - rawBaseY) * effExtrude : 0;

          // Compute exact screen bounding box for sweep-and-prune occlusion sorting
          let screenMinX = Infinity;
          let screenMaxX = -Infinity;
          let screenMinY = Infinity;
          let screenMaxY = -Infinity;
          const sp = slice.sortPoly.length >= 2 ? slice.sortPoly : wing.footprint;
          for (let k = 0; k < sp.length; k++) {
            const pt = sp[k];
            const pb = proj(pt.x, pt.z, sliceMinElev);
            const pr = wingExtrude ? proj(pt.x, pt.z, sliceMaxElev) : pb;
            if (pb.sx < screenMinX) screenMinX = pb.sx;
            if (pb.sx > screenMaxX) screenMaxX = pb.sx;
            if (pr.sx < screenMinX) screenMinX = pr.sx;
            if (pr.sx > screenMaxX) screenMaxX = pr.sx;
            if (pb.sy < screenMinY) screenMinY = pb.sy;
            if (pb.sy > screenMaxY) screenMaxY = pb.sy;
            if (pr.sy < screenMinY) screenMinY = pr.sy;
            if (pr.sy > screenMaxY) screenMaxY = pr.sy;
          }
          if (
            screenMaxX < -60 ||
            screenMinX > width + 60 ||
            screenMaxY < -60 ||
            screenMinY > height + 60
          ) {
            continue;
          }

          sortableSlices.push({
            payload: {
              item,
              slice,
              rawBaseY,
              baseElev,
              wingExtrude,
              effExtrude,
              bldgAnim,
              isSelected,
              isMultiSelected,
              isActiveWing,
              isHovered,
              isMergeCandidate,
              depthHint: pCenter.depth,
              topYHint,
            },
            sortPoly: sp,
            minY: wingExtrude ? sliceMinElev : slice.minY,
            maxY: wingExtrude ? sliceMaxElev : slice.maxY,
            screenMinX,
            screenMaxX,
            screenMinY,
            screenMaxY,
          });
        }
      }

      const orderedSlices: DrawSlicePayload[] = extrudeBuildings
        ? sortBuildingRenderSlices(sortableSlices, cam)
        : sortableSlices
            .map((s) => s.payload)
            .sort((a, b) =>
              Math.abs(a.topYHint - b.topYHint) > 0.25
                ? a.topYHint - b.topYHint
                : a.depthHint - b.depthHint
            );

      for (let idx = 0; idx < orderedSlices.length; idx++) {
        const {
          item,
          slice,
          rawBaseY,
          baseElev,
          wingExtrude,
          effExtrude,
          bldgAnim,
          isSelected,
          isMultiSelected,
          isActiveWing,
          isHovered,
          isMergeCandidate,
        } = orderedSlices[idx];
        const b = item.building;
        const wing = item.wing;
        const n = wing.footprint.length;
        if (n < 3) continue;

        const colors = palette[b.category] || palette.residential;
        const roofElev = wingExtrude ? baseElev + wing.height * effExtrude : 0;

        const basePts = new Array(n);
        const roofPts = new Array(n);
        for (let k = 0; k < n; k++) {
          const pt = wing.footprint[k];
          const bp = proj(pt.x, pt.z, baseElev);
          basePts[k] = bp;
          roofPts[k] = wingExtrude ? proj(pt.x, pt.z, roofElev) : bp;
        }

        ctx.save();
        const itemBldgAlpha = (isSelected || isMultiSelected ? 1 : buildingAlpha) * bldgAnim;
        if (isHybrid && !isSelected && !isMultiSelected) {
          ctx.globalAlpha = 0.58 * itemBldgAlpha;
        } else if (itemBldgAlpha < 0.995) {
          ctx.globalAlpha = itemBldgAlpha;
        }

        // Pre-query only nearby upwind buildings once per receiver slice (O(k) instead of O(N^2)!)
        const allowReceiverCastShadows =
          activeShadowSolar !== null &&
          activeShadowSolar.shadowOpacity > 0.05 &&
          shadowWings.length > 1 &&
          !denseScene &&
          !isHybrid &&
          visibleWings.length <= (isMobile ? 160 : 350) &&
          (!isInteracting || visibleWings.length <= 140);
        let localShadowCasters: IndexedBuildingWing[] = [];
        if (allowReceiverCastShadows && activeShadowSolar) {
          const localReach = Math.min(180, 90 * activeShadowSolar.shadowLengthPerBlock + 24);
          localShadowCasters = st.buildingIndices.wingIndex.queryAABB(
            {
              minX: item.aabb.minX - Math.max(8, activeShadowSolar.shadowDir.x * localReach),
              maxX: item.aabb.maxX + Math.max(8, -activeShadowSolar.shadowDir.x * localReach),
              minZ: item.aabb.minZ - Math.max(8, activeShadowSolar.shadowDir.z * localReach),
              maxZ: item.aabb.maxZ + Math.max(8, -activeShadowSolar.shadowDir.z * localReach),
            },
            localShadowCastersBuf.current
          );
        }

        // Extruded vertical side walls using vertically clipped wall slices (zero buried internal shafts!)
        if (wingExtrude && slice.wallSlices.length > 0) {
          let signedArea2 = 0;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            signedArea2 += basePts[i].sx * basePts[j].sy - basePts[j].sx * basePts[i].sy;
          }
          const isCW = signedArea2 >= 0;

          const frontWalls: Array<{
            edge: BuildingWallSlice;
            b1: { sx: number; sy: number; depth: number };
            b2: { sx: number; sy: number; depth: number };
            r1: { sx: number; sy: number; depth: number };
            r2: { sx: number; sy: number; depth: number };
            midDepth: number;
          }> = [];

          for (let i = 0; i < slice.wallSlices.length; i++) {
            const edge = slice.wallSlices[i];
            const edgeBaseElev = baseElev + (edge.minY - rawBaseY) * effExtrude;
            const edgeRoofElev = baseElev + (edge.maxY - rawBaseY) * effExtrude;
            if (edgeRoofElev - edgeBaseElev < 0.05) continue;

            const b1 = proj(edge.a.x, edge.a.z, edgeBaseElev);
            const b2 = proj(edge.b.x, edge.b.z, edgeBaseElev);
            const edgeDx = b2.sx - b1.sx;
            const edgeDy = b2.sy - b1.sy;
            const edgeLenPx = Math.hypot(edgeDx, edgeDy);
            if (edgeLenPx < 0.05) continue;

            const outwardNy = isCW ? -edgeDx : edgeDx;
            if (outwardNy <= -0.02 * edgeLenPx) continue; // Back-facing wall hidden behind building body!

            const r1 = proj(edge.a.x, edge.a.z, edgeRoofElev);
            const r2 = proj(edge.b.x, edge.b.z, edgeRoofElev);
            frontWalls.push({
              edge,
              b1,
              b2,
              r1,
              r2,
              midDepth: (b1.depth + b2.depth) * 0.5,
            });
          }

          // Sort front-facing walls back-to-front so concave freeform wings never self-occlude
          if (frontWalls.length > 2) {
            frontWalls.sort((wa, wb) =>
              Math.abs(wa.midDepth - wb.midDepth) > 0.1
                ? wa.midDepth - wb.midDepth
                : wa.edge.minY - wb.edge.minY
            );
          }

          for (let i = 0; i < frontWalls.length; i++) {
            const { edge, b1, b2, r1, r2 } = frontWalls[i];
            // Micro-overlap across horizontal split seams in opaque mode eliminates canvas AA hairlines
            const botPad = !isHybrid && edge.continueBottom ? 0.45 : 0;
            const b1Sy = b1.sy + botPad;
            const b2Sy = b2.sy + botPad;

            const edgeDx = b2.sx - b1.sx;
            const edgeDy = b2.sy - b1.sy;
            const facadeSolarSource = activeShadowSolar ?? solarPos;
            const solarIntensity =
              facadeSolarSource !== null
                ? computeFacadeSolarIntensity(edge.outNx, edge.outNz, facadeSolarSource)
                : null;
            const lightSide =
              solarIntensity !== null ? solarIntensity >= 0.54 : edgeDx - edgeDy > 0;

            ctx.beginPath();
            ctx.moveTo(b1.sx, b1Sy);
            ctx.lineTo(b2.sx, b2Sy);
            ctx.lineTo(r2.sx, r2.sy);
            ctx.lineTo(r1.sx, r1.sy);
            ctx.closePath();
            ctx.fillStyle = isMergeCandidate
              ? lightSide
                ? '#F59E0B'
                : '#D97706'
              : isMultiSelected
              ? lightSide
                ? '#38BDF8'
                : '#0284C7'
              : isActiveWing
              ? lightSide
                ? '#F3C63B'
                : '#D9AB24'
              : isSelected
              ? lightSide
                ? '#E8CF7A'
                : '#CCA94A'
              : lightSide
              ? colors.wallA
              : colors.wallB;
            ctx.fill();

            // Physical directional solar facade shading (sunlit warm tint vs leeward shadow)
            if (
              solarPos &&
              solarIntensity !== null &&
              !isSelected &&
              !isMultiSelected &&
              !isMergeCandidate
            ) {
              if (solarIntensity > 0.62 && solarPos.shadowOpacity > 0.05) {
                const warmAmt =
                  (solarIntensity - 0.62) *
                  (0.28 + solarPos.goldenHourFactor * 0.34) *
                  solarPos.shadowOpacity;
                ctx.fillStyle =
                  solarPos.goldenHourFactor > 0.3
                    ? `rgba(255, 196, 120, ${warmAmt.toFixed(3)})`
                    : `rgba(255, 248, 224, ${warmAmt.toFixed(3)})`;
                ctx.fill();
              } else if (solarIntensity < 0.52 && solarPos.shadowOpacity > 0.05) {
                const shadeAmt =
                  (0.52 - solarIntensity) *
                  insolationState!.shadowStrength *
                  0.62 *
                  solarPos.shadowOpacity;
                ctx.fillStyle = `rgba(15, 23, 42, ${shadeAmt.toFixed(3)})`;
                ctx.fill();
              }
            }

            // Environment-aware cast shadows from nearby upwind buildings onto this sun-facing wall slice
            let wallPathNeedsRebuild = false;
            if (
              allowReceiverCastShadows &&
              activeShadowSolar &&
              solarIntensity !== null &&
              solarIntensity > 0.42 &&
              localShadowCasters.length > 1 &&
              !isSelected &&
              !isMultiSelected &&
              !isMergeCandidate
            ) {
              const myBaseY = edge.minY;
              const myTopY = edge.maxY;
              const wallMinX = Math.min(edge.a.x, edge.b.x);
              const wallMaxX = Math.max(edge.a.x, edge.b.x);
              const wallMinZ = Math.min(edge.a.z, edge.b.z);
              const wallMaxZ = Math.max(edge.a.z, edge.b.z);

              let wallClipped = false;
              for (let j = 0; j < localShadowCasters.length; j++) {
                const caster = localShadowCasters[j];
                if (caster.wing.id === wing.id) continue;
                const casterBaseY = caster.wing.baseY ?? caster.building.baseY ?? SERVER_GROUND_Y;
                const casterTopY = casterBaseY + caster.wing.height;
                if (casterTopY <= myBaseY + 0.4) continue;

                const maxReach =
                  Math.max(0, casterTopY - myBaseY) * activeShadowSolar.shadowLengthPerBlock;
                const cdx = activeShadowSolar.shadowDir.x * maxReach;
                const cdz = activeShadowSolar.shadowDir.z * maxReach;
                if (
                  caster.aabb.maxX + Math.max(0, cdx) < wallMinX - 0.5 ||
                  caster.aabb.minX + Math.min(0, cdx) > wallMaxX + 0.5 ||
                  caster.aabb.maxZ + Math.max(0, cdz) < wallMinZ - 0.5 ||
                  caster.aabb.minZ + Math.min(0, cdz) > wallMaxZ + 0.5
                ) {
                  continue;
                }

                const wallPolys = computeWallShadowPolygons(
                  edge.a,
                  edge.b,
                  edge.outNx,
                  edge.outNz,
                  myBaseY,
                  myTopY,
                  caster.wing.footprint,
                  casterBaseY,
                  casterTopY,
                  activeShadowSolar
                );
                if (wallPolys.length === 0) continue;

                if (!wallClipped) {
                  ctx.save();
                  ctx.clip(); // Wall quad [b1, b2, r2, r1] is already the active path
                  ctx.beginPath();
                  wallClipped = true;
                  wallPathNeedsRebuild = true;
                }

                for (let pIdx = 0; pIdx < wallPolys.length; pIdx++) {
                  const wPoly = wallPolys[pIdx];
                  const projPoly = ensureScreenPolygonCW(
                    wPoly.map((pt) =>
                      proj(
                        pt.x,
                        pt.z,
                        baseElev + (pt.y - rawBaseY) * effExtrude
                      )
                    )
                  );
                  ctx.moveTo(projPoly[0].sx, projPoly[0].sy);
                  for (let k = 1; k < projPoly.length; k++) {
                    ctx.lineTo(projPoly[k].sx, projPoly[k].sy);
                  }
                  ctx.closePath();
                }
              }

              if (wallClipped) {
                const sunlitFade = Math.min(1, Math.max(0, (solarIntensity - 0.40) / 0.24));
                const wallCastAlpha = insolationActive
                  ? Math.min(
                      0.55,
                      activeShadowSolar.shadowOpacity *
                        insolationState!.shadowStrength *
                        (isDark ? 0.44 : 0.32) *
                        sunlitFade
                    )
                  : (isDark ? 0.24 : 0.14) * sunlitFade;
                if (wallCastAlpha > 0.008) {
                  ctx.fillStyle = isDark
                    ? `rgba(2, 6, 23, ${wallCastAlpha.toFixed(3)})`
                    : `rgba(15, 23, 42, ${wallCastAlpha.toFixed(3)})`;
                  ctx.fill();
                }
                ctx.restore();
              }
            }

            if (!denseScene && n < 10) {
              ctx.strokeStyle = isMultiSelected ? '#0369A1' : isSelected ? '#C28B00' : colors.stroke;
              ctx.lineWidth = 0.7;
              const isCleanQuad =
                !edge.splitAtStart &&
                !edge.splitAtEnd &&
                !edge.continueBottom &&
                !edge.continueTop;
              if (isCleanQuad) {
                if (wallPathNeedsRebuild) {
                  ctx.beginPath();
                  ctx.moveTo(b1.sx, b1.sy);
                  ctx.lineTo(b2.sx, b2.sy);
                  ctx.lineTo(r2.sx, r2.sy);
                  ctx.lineTo(r1.sx, r1.sy);
                  ctx.closePath();
                }
                ctx.stroke();
              } else {
                // Selectively stroke only exposed exterior edges of split wall slices (zero internal seam lines!)
                ctx.beginPath();
                if (!edge.continueBottom) {
                  ctx.moveTo(b1.sx, b1.sy);
                  ctx.lineTo(b2.sx, b2.sy);
                }
                if (!edge.splitAtEnd) {
                  ctx.moveTo(b2.sx, b2.sy);
                  ctx.lineTo(r2.sx, r2.sy);
                }
                if (!edge.continueTop) {
                  ctx.moveTo(r2.sx, r2.sy);
                  ctx.lineTo(r1.sx, r1.sy);
                }
                if (!edge.splitAtStart) {
                  ctx.moveTo(r1.sx, r1.sy);
                  ctx.lineTo(b1.sx, b1.sy);
                }
                ctx.stroke();
              }
            }
          }
        }

        // Roof polygon fill, roof-on-roof shadow, roof border, active guide & accents (drawn once on top slice!)
        if (slice.drawRoof) {
          ctx.beginPath();
          for (let k = 0; k < n; k++) {
            if (k === 0) ctx.moveTo(roofPts[k].sx, roofPts[k].sy);
            else ctx.lineTo(roofPts[k].sx, roofPts[k].sy);
          }
          ctx.closePath();
          const isEraserHoverBldg = st.editorTool === 'delete-area' && isHovered;
          ctx.fillStyle = isEraserHoverBldg
            ? 'rgba(239, 68, 68, 0.55)'
            : isMergeCandidate
            ? 'rgba(245, 158, 11, 0.58)'
            : isMultiSelected
            ? isDark
              ? '#0C4A6E'
              : '#BAE6FD'
            : isActiveWing
            ? isDark
              ? '#52461B'
              : '#FFF0B3'
            : isSelected
            ? isDark
              ? '#463E23'
              : '#F9EDC2'
            : isHovered
            ? isDark
              ? '#474D5C'
              : '#F6F2E4'
            : colors.roof;
          ctx.fill();

          // Environment-aware roof-on-roof shadow projection (active in BOTH Solar Insolation & Ambient 3D modes!):
          // Taller nearby buildings/wings cast a single unified, non-overlapping shadow onto lower roofs!
          if (allowReceiverCastShadows && activeShadowSolar && localShadowCasters.length > 1) {
            const myTopY = rawBaseY + wing.height;
            let roofShadowClipped = false;
            for (let j = 0; j < localShadowCasters.length; j++) {
              const caster = localShadowCasters[j];
              if (caster.wing.id === wing.id) continue;
              const casterBaseY = caster.wing.baseY ?? caster.building.baseY ?? SERVER_GROUND_Y;
              const casterTopY = casterBaseY + caster.wing.height;
              const deltaH = casterTopY - myTopY;
              if (deltaH <= 0.9) continue;

              const cGeom = computeWingShadowGeometry(
                caster.wing.footprint,
                deltaH,
                activeShadowSolar
              );
              if (!cGeom) continue;
              const cBaseDelta = Math.max(0, casterBaseY - myTopY);
              const cBaseOff =
                cBaseDelta > 0.2
                  ? computeShadowOffset(cBaseDelta, activeShadowSolar)
                  : { dx: 0, dz: 0 };

              // Quick world AABB overlap check between caster's projected roof shadow & this wing
              const cMinX = Math.min(caster.aabb.minX + cBaseOff.dx, caster.aabb.minX + cGeom.dx);
              const cMaxX = Math.max(caster.aabb.maxX + cBaseOff.dx, caster.aabb.maxX + cGeom.dx);
              const cMinZ = Math.min(caster.aabb.minZ + cBaseOff.dz, caster.aabb.minZ + cGeom.dz);
              const cMaxZ = Math.max(caster.aabb.maxZ + cBaseOff.dz, caster.aabb.maxZ + cGeom.dz);
              if (
                cMaxX < item.aabb.minX ||
                cMinX > item.aabb.maxX ||
                cMaxZ < item.aabb.minZ ||
                cMinZ > item.aabb.maxZ
              ) {
                continue;
              }

              if (!roofShadowClipped) {
                ctx.save();
                ctx.clip(); // Current path is already this wing's roof polygon!
                ctx.beginPath();
                roofShadowClipped = true;
              }

              const cfp = caster.wing.footprint;
              const cn = cfp.length;
              const cBase: Array<{ sx: number; sy: number }> = new Array(cn);
              const cShad: Array<{ sx: number; sy: number }> = new Array(cn);
              for (let k = 0; k < cn; k++) {
                cBase[k] = proj(cfp[k].x + cBaseOff.dx, cfp[k].z + cBaseOff.dz, roofElev);
                cShad[k] = proj(cGeom.shiftedRoof[k].x, cGeom.shiftedRoof[k].z, roofElev);
              }

              const cShadCw = ensureScreenPolygonCW(cShad);
              ctx.moveTo(cShadCw[0].sx, cShadCw[0].sy);
              for (let k = 1; k < cn; k++) {
                ctx.lineTo(cShadCw[k].sx, cShadCw[k].sy);
              }
              ctx.closePath();

              if (cBaseDelta > 0.2) {
                const cBaseCw = ensureScreenPolygonCW(cBase);
                ctx.moveTo(cBaseCw[0].sx, cBaseCw[0].sy);
                for (let k = 1; k < cn; k++) {
                  ctx.lineTo(cBaseCw[k].sx, cBaseCw[k].sy);
                }
                ctx.closePath();
              }

              for (let k = 0; k < cn; k++) {
                const nxt = (k + 1) % cn;
                const quadCw = ensureScreenPolygonCW([cBase[k], cBase[nxt], cShad[nxt], cShad[k]]);
                ctx.moveTo(quadCw[0].sx, quadCw[0].sy);
                ctx.lineTo(quadCw[1].sx, quadCw[1].sy);
                ctx.lineTo(quadCw[2].sx, quadCw[2].sy);
                ctx.lineTo(quadCw[3].sx, quadCw[3].sy);
                ctx.closePath();
              }
            }
            if (roofShadowClipped) {
              const selFactor = isSelected || isMultiSelected ? 0.65 : 1;
              const roofShadAlpha = insolationActive
                ? Math.min(
                    0.55,
                    activeShadowSolar.shadowOpacity *
                      insolationState!.shadowStrength *
                      (isDark ? 0.48 : 0.36) *
                      selFactor
                  )
                : (isDark ? 0.28 : 0.16) * selFactor * extrudeFactor;
              ctx.fillStyle = isDark
                ? `rgba(2, 6, 23, ${roofShadAlpha.toFixed(3)})`
                : `rgba(15, 23, 42, ${roofShadAlpha.toFixed(3)})`;
              ctx.fill();
              ctx.restore();
              // Rebuild roof path for single-wing border stroke below
              ctx.beginPath();
              for (let k = 0; k < n; k++) {
                if (k === 0) ctx.moveTo(roofPts[k].sx, roofPts[k].sy);
                else ctx.lineTo(roofPts[k].sx, roofPts[k].sy);
              }
              ctx.closePath();
            }
          }

          // Roof outer border — strictly along exposedRoofEdges (seamless merged roofs for same-height attached wings!)
          if (item.exposedRoofEdges.length > 0) {
            if (isHybrid && !isSelected && !isMultiSelected) ctx.globalAlpha = 0.95 * itemBldgAlpha;
            ctx.strokeStyle = isEraserHoverBldg
              ? '#DC2626'
              : isMergeCandidate
              ? '#D97706'
              : isMultiSelected
              ? '#0284C7'
              : isActiveWing
              ? '#FC3F1D'
              : isSelected
              ? '#E5A800'
              : isHovered
              ? '#E5A800'
              : isHybrid
              ? '#FFCC00'
              : colors.stroke;
            ctx.lineWidth = isEraserHoverBldg
              ? 2.4
              : isMergeCandidate || isMultiSelected
              ? 2.6
              : isActiveWing
              ? 2.3
              : isSelected
              ? 1.7
              : isHovered
              ? 1.5
              : isHybrid
              ? 1.15
              : 0.9;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (!item.hasMultiWings) {
              ctx.stroke();
            } else {
              ctx.beginPath();
              for (let eIdx = 0; eIdx < item.exposedRoofEdges.length; eIdx++) {
                const edge = item.exposedRoofEdges[eIdx];
                const p1 = proj(edge.a.x, edge.a.z, roofElev);
                const p2 = proj(edge.b.x, edge.b.z, roofElev);
                ctx.moveTo(p1.sx, p1.sy);
                ctx.lineTo(p2.sx, p2.sy);
              }
              ctx.stroke();
            }
          }

          // When editing a specific wing of a multi-wing building, show a subtle dashed guide so the active wing is clear
          if (isActiveWing && item.hasMultiWings && st.isEditorMode) {
            ctx.beginPath();
            for (let k = 0; k < n; k++) {
              if (k === 0) ctx.moveTo(roofPts[k].sx, roofPts[k].sy);
              else ctx.lineTo(roofPts[k].sx, roofPts[k].sy);
            }
            ctx.closePath();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(252, 63, 29, 0.55)';
            ctx.lineWidth = 1.25;
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Architectural roof profile accent (only when close and not dragging)
          if (wingExtrude && roofPts.length >= 4 && cam.zoom >= 0.34 && !isInteracting && !denseScene) {
            const rType = wing.roofType ?? b.roofType ?? 'flat';
            if (rType === 'pitched' && roofPts.length === 4) {
              const m01x = (roofPts[0].sx + roofPts[1].sx) * 0.5;
              const m01y = (roofPts[0].sy + roofPts[1].sy) * 0.5;
              const m23x = (roofPts[2].sx + roofPts[3].sx) * 0.5;
              const m23y = (roofPts[2].sy + roofPts[3].sy) * 0.5;
              ctx.beginPath();
              ctx.moveTo(m01x, m01y);
              ctx.lineTo(m23x, m23y);
              ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(90,82,66,0.32)';
              ctx.lineWidth = 1.1;
              ctx.stroke();
            } else if (rType === 'curved') {
              const rc = proj(wing.x, wing.z, roofElev + 3);
              const oppIdx = roofPts.length >= 10 ? Math.floor(roofPts.length / 2) : 1;
              const span = Math.hypot(
                roofPts[oppIdx].sx - roofPts[0].sx,
                roofPts[oppIdx].sy - roofPts[0].sy
              );
              if (span > 16) {
                ctx.beginPath();
                ctx.ellipse(rc.sx, rc.sy, span * 0.25, span * 0.16, 0, 0, Math.PI * 2);
                ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.24)' : 'rgba(90,82,66,0.28)';
                ctx.lineWidth = 1;
                ctx.stroke();
              }
            } else if (rType === 'complex') {
              const rc = proj(wing.x, wing.z, roofElev);
              ctx.beginPath();
              for (let k = 0; k < roofPts.length; k++) {
                const ix = rc.sx + (roofPts[k].sx - rc.sx) * 0.55;
                const iy = rc.sy + (roofPts[k].sy - rc.sy) * 0.55;
                if (k === 0) ctx.moveTo(ix, iy);
                else ctx.lineTo(ix, iy);
              }
              ctx.closePath();
              ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(90,82,66,0.24)';
              ctx.lineWidth = 0.9;
              ctx.stroke();
            }
          }
        }

        ctx.restore();

        // Defer Building Category Symbol, Address House Number & Landmark Name to strict-priority Pass 9
        if (slice.drawRoof && item.isLabelHost && !isInteracting) {
          let minRx = Infinity;
          let maxRx = -Infinity;
          let minRy = Infinity;
          let maxRy = -Infinity;
          for (let k = 0; k < roofPts.length; k++) {
            const rp = roofPts[k];
            if (rp.sx < minRx) minRx = rp.sx;
            if (rp.sx > maxRx) maxRx = rp.sx;
            if (rp.sy < minRy) minRy = rp.sy;
            if (rp.sy > maxRy) maxRy = rp.sy;
          }
          const roofSpanPx = Math.max(
            Math.min(maxRx - minRx, maxRy - minRy),
            item.labelAnchor.maxRadius * 2 * cam.zoom
          );
          const anchorBaseElev = useElevY
            ? Math.max(-18, item.labelAnchor.baseY - SERVER_GROUND_Y)
            : 0;
          const anchorRoofElev = wingExtrude
            ? anchorBaseElev + item.labelAnchor.height * effExtrude
            : 0;
          const rc = proj(item.labelAnchor.x, item.labelAnchor.z, anchorRoofElev);

          if (rc.sx >= -40 && rc.sx <= width + 40 && rc.sy >= -40 && rc.sy <= height + 40) {
            deferredBuildingAnnotations.push({
              key: `bldg-ann:${b.id}`,
              building: b,
              sx: rc.sx,
              sy: rc.sy,
              roofSpanPx,
              isSelected,
              isHovered,
              wingAnim: bldgAnim,
            });
          }
        }
      }

      // Pass 6.5: Atmospheric Solar Lighting Tint (Golden Hour warmth & Twilight/Night ambient wash)
      if (insolationActive && solarPos) {
        if (solarPos.goldenHourFactor > 0.04) {
          ctx.save();
          ctx.fillStyle = `rgba(255, 168, 76, ${(solarPos.goldenHourFactor * (isDark ? 0.08 : 0.11)).toFixed(3)})`;
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        }
        if (solarPos.daylightFactor < 0.98) {
          const duskAlpha =
            (1 - solarPos.daylightFactor) *
            Math.max(0.45, insolationState!.shadowStrength) *
            (isDark ? 0.34 : 0.44);
          ctx.save();
          ctx.fillStyle = `rgba(12, 20, 42, ${duskAlpha.toFixed(3)})`;
          ctx.fillRect(0, 0, width, height);
          ctx.restore();
        }
      }

      // 7. Active Computed Route Polyline
      if (st.activeRoute) {
        for (let l = 0; l < st.activeRoute.legs.length; l++) {
          const leg = st.activeRoute.legs[l];
          if (leg.points.length < 2) continue;
          ctx.beginPath();
          for (let idx = 0; idx < leg.points.length; idx++) {
            const p = proj(leg.points[idx].x, leg.points[idx].z, is3D ? 2 : 0);
            if (idx === 0) ctx.moveTo(p.sx, p.sy);
            else ctx.lineTo(p.sx, p.sy);
          }
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (leg.type === 'walk') {
            ctx.strokeStyle = isDark ? 'rgba(20,22,28,0.85)' : 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 7;
            ctx.stroke();
            ctx.setLineDash([6, 6]);
            ctx.strokeStyle = '#3B82F6';
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (leg.type === 'auto') {
            ctx.strokeStyle = isDark ? '#0F172A' : '#FFFFFF';
            ctx.lineWidth = 10;
            ctx.stroke();
            ctx.strokeStyle = '#2563EB';
            ctx.lineWidth = 6;
            ctx.stroke();
          } else if (leg.type === 'sim') {
            ctx.strokeStyle = isDark ? 'rgba(20,22,28,0.9)' : '#FFFFFF';
            ctx.lineWidth = 8.5;
            ctx.stroke();
            ctx.strokeStyle = '#0D9488';
            ctx.lineWidth = 5;
            ctx.stroke();
          } else {
            ctx.strokeStyle = isDark ? '#111318' : '#FFFFFF';
            ctx.lineWidth = 9.5;
            ctx.stroke();
            ctx.strokeStyle = leg.routeColor || '#FC3F1D';
            ctx.lineWidth = 6;
            ctx.stroke();
          }
        }
      }

      // 8. Live Public Transit Vehicles Synchronized with Real MTR Schedule & Local Clock
      if (st.layers.mtrLines && st.layers.liveVehicles && lod.opacity.vehicles > 0.02 && !isInteracting) {
        const syncedNowEpochMs = Date.now() + (st.serverClockOffsetMs ?? 0);
        const showDetailedIcons = cam.zoom >= 0.34;
        let drawnVehicles = 0;

        for (let rIdx = 0; rIdx < visibleRoutes.length; rIdx++) {
          const item = visibleRoutes[rIdx];
          const route = item.route;
          if (st.layers.metroOnly && route.kind !== 'metro') continue;
          const vehAlpha =
            route.kind === 'metro'
              ? lod.opacity.vehicles
              : Math.min(lod.opacity.vehicles, lod.opacity.surfaceTransit);
          if (vehAlpha <= 0.02) continue;
          if (item.totalLen < 5) continue;
          if (drawnVehicles > 140) break;

          const depInfo = st.departuresMap?.get(route.id);
          const maxOnRoute = route.kind === 'metro' ? 5 : 3;
          const activeVehicles = computeActiveVehiclesOnRoute(
            route,
            syncedNowEpochMs,
            depInfo,
            maxOnRoute
          );

          const vehAnim = elementAnimator.getProgress(`veh:${route.id}`, now);
          const finalVehAlpha = vehAlpha * vehAnim;
          if (finalVehAlpha <= 0.02) continue;

          ctx.save();
          if (finalVehAlpha < 0.995) ctx.globalAlpha = finalVehAlpha;
          for (let v = 0; v < activeVehicles.length; v++) {
            const veh = activeVehicles[v];
            const targetDist = veh.progress01 * item.totalLen;
            const sample = samplePointAlongRoute3D(item, targetDist);
            const elev = useElevY
              ? Math.max(-20, Math.min(84, sample.y - SERVER_GROUND_Y + 2))
              : is3D
              ? 3
              : 0;
            const vp = proj(sample.x, sample.z, elev);
            if (vp.sx < -24 || vp.sx > width + 24 || vp.sy < -24 || vp.sy > height + 24) continue;

            drawnVehicles++;

            if (showDetailedIcons) {
              const a = item.offsetPts3D[sample.segIdx];
              const b = item.offsetPts3D[sample.segIdx + 1] ?? a;
              const pA = proj(a.x, a.z, elev);
              const pB = proj(b.x, b.z, elev);
              const headingRad = Math.atan2(pB.sy - pA.sy, pB.sx - pA.sx);
              drawDetailedVehicleIcon(
                ctx,
                vp.sx,
                vp.sy,
                headingRad,
                route.kind,
                route.color,
                route.number,
                cam.zoom,
                isDark
              );
            } else {
              ctx.beginPath();
              ctx.arc(vp.sx, vp.sy, route.kind === 'metro' ? 5.2 : 4, 0, Math.PI * 2);
              ctx.fillStyle = route.color;
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.strokeStyle = '#FFFFFF';
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }

      // 9. Unified Strict-Priority Cartographic Label & Symbol Engine
      // Resolves collision top-down in strict scale hierarchy (Interactive > Cities/Towns/Villages > Districts > Metro >
      // Rail > Major POIs > Surface Stops > Land Labels > Street Names > Minor POIs > Building Icons/Numbers/Names).
      // Geographic places (cities, towns, villages, districts) use a dedicated placeLabelGrid so they NEVER get hidden
      // by stations, stops, lines, or buildings at their active zoom level, and always paint ON TOP of them!
      const labelGrid = labelGridRef.current;
      labelGrid.clear();
      const placeLabelGrid = placeLabelGridRef.current;
      placeLabelGrid.clear();
      renderedPlaceHitsRef.current.length = 0;

      // Reserve station/POI/street/building text strictly outside BOTH other labels AND all geographic places
      const tryPlaceLabelCandidates = (
        boxes: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>,
        force = false
      ): number => {
        if (boxes.length === 0) return -1;
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          if (
            labelGrid.canPlace(b.x1, b.y1, b.x2, b.y2) &&
            placeLabelGrid.canPlace(b.x1, b.y1, b.x2, b.y2)
          ) {
            labelGrid.reserve(b.x1, b.y1, b.x2, b.y2);
            return i;
          }
        }
        if (force) {
          const b = boxes[0];
          labelGrid.reserve(b.x1, b.y1, b.x2, b.y2);
          return 0;
        }
        return -1;
      };

      const tryPlaceSingleLabel = (
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        force = false
      ): boolean => {
        if (
          !force &&
          (!labelGrid.canPlace(x1, y1, x2, y2) || !placeLabelGrid.canPlace(x1, y1, x2, y2))
        ) {
          return false;
        }
        labelGrid.reserve(x1, y1, x2, y2);
        return true;
      };

      // Geographic place labels (cities, towns, villages, districts) NEVER get hidden at their zoom level.
      // If two place labels overlap each other (e.g., city + central district), gently nudge vertically first.
      const resolvePlaceVerticalOffset = (
        boxX1: number,
        boxY1: number,
        boxX2: number,
        boxY2: number,
        pinExact: boolean
      ): number => {
        if (pinExact || placeLabelGrid.canPlace(boxX1, boxY1, boxX2, boxY2)) {
          placeLabelGrid.reserve(boxX1, boxY1, boxX2, boxY2);
          return 0;
        }
        const offsets = [16, -16, 30, -30];
        for (let i = 0; i < offsets.length; i++) {
          const dy = offsets[i];
          if (placeLabelGrid.canPlace(boxX1, boxY1 + dy, boxX2, boxY2 + dy)) {
            placeLabelGrid.reserve(boxX1, boxY1 + dy, boxX2, boxY2 + dy);
            return dy;
          }
        }
        placeLabelGrid.reserve(boxX1, boxY1, boxX2, boxY2);
        return 0;
      };

      const placedDrawOps: Array<{ priorityTier: number; draw: () => void }> = [];
      const placedStationNames = new Map<string, Array<{ sx: number; sy: number }>>();
      const isDuplicateStationNear = (normName: string, sx: number, sy: number, minDistPx: number): boolean => {
        if (!normName) return false;
        const prev = placedStationNames.get(normName);
        if (!prev) return false;
        const minDistSq = minDistPx * minDistPx;
        for (let k = 0; k < prev.length; k++) {
          const dx = prev[k].sx - sx;
          const dy = prev[k].sy - sy;
          if (dx * dx + dy * dy < minDistSq) return true;
        }
        return false;
      };
      const recordPlacedStationName = (normName: string, sx: number, sy: number) => {
        if (!normName) return;
        let arr = placedStationNames.get(normName);
        if (!arr) {
          arr = [];
          placedStationNames.set(normName, arr);
        }
        arr.push({ sx, sy });
      };

      const applyPopInTransform = (cx: number, cy: number, anim: number) => {
        if (anim < 0.995) {
          const s = 0.78 + 0.22 * anim;
          ctx.translate(cx, cy);
          ctx.scale(s, s);
          ctx.translate(-cx, -cy);
        }
      };

      const selectedStationId =
        st.selectedEntity?.type === 'station' ? st.selectedEntity.data.id : null;
      const hoveredStationId = hoveredStationIdRef.current;
      const selectedPoiId = st.selectedEntity?.type === 'poi' ? st.selectedEntity.data.id : null;
      const hoveredPoiId = hoveredPoiIdRef.current;
      const allPlaces =
        st.places && st.places.length > 0
          ? st.places
          : [...st.regionalSettlements, ...MURS_DISTRICTS];
      const selectedPlaceId =
        !st.photoMode && st.selectedEntity?.type === 'place' ? st.selectedEntity.data.id : null;
      const hoveredPlaceId = !st.photoMode ? hoveredPlaceIdRef.current : null;
      const isPlaceEditMode =
        !st.photoMode &&
        st.isEditorMode &&
        (st.editorTool === 'add-place' || st.selectedEntity?.type === 'place');

      const visibleStations =
        lod.opacity.metroRailStations <= 0.02 && lod.opacity.surfaceStations <= 0.02
          ? []
          : st.stationIndices.stationIndex.queryAABB(viewBounds, visibleStationsBuf.current);

      // Partition places into settlements (cities/towns/villages) and districts, each sorted by strict hierarchy
      const settlementPlaces: MapPlaceLabel[] = [];
      const districtPlaces: MapPlaceLabel[] = [];
      for (let i = 0; i < allPlaces.length; i++) {
        if (allPlaces[i].tier === 'district') districtPlaces.push(allPlaces[i]);
        else settlementPlaces.push(allPlaces[i]);
      }
      settlementPlaces.sort((a, b) => getPlaceHierarchyPriority(b) - getPlaceHierarchyPriority(a));
      districtPlaces.sort((a, b) => getPlaceHierarchyPriority(b) - getPlaceHierarchyPriority(a));

      // Partition visible stations into strict tiers: Metro > Rail > Surface Stops
      const metroStations: MtrStation[] = [];
      const railStations: MtrStation[] = [];
      const surfaceStationsList: MtrStation[] = [];
      for (let i = 0; i < visibleStations.length; i++) {
        const s = visibleStations[i];
        if (st.layers.metroOnly && !s.kinds.includes('metro')) continue;
        if (s.kinds.includes('metro')) metroStations.push(s);
        else if (s.kinds.includes('rail')) railStations.push(s);
        else surfaceStationsList.push(s);
      }
      metroStations.sort((a, b) => getStationHierarchyPriority(b) - getStationHierarchyPriority(a));
      railStations.sort((a, b) => getStationHierarchyPriority(b) - getStationHierarchyPriority(a));
      surfaceStationsList.sort(
        (a, b) => getStationHierarchyPriority(b) - getStationHierarchyPriority(a)
      );

      // Partition visible POIs into Major POIs and Minor POIs
      const majorPoisList: MapPoi[] = [];
      const minorPoisList: MapPoi[] = [];
      for (let i = 0; i < st.pois.length; i++) {
        const poi = st.pois[i];
        if (
          poi.x < viewBounds.minX ||
          poi.x > viewBounds.maxX ||
          poi.z < viewBounds.minZ ||
          poi.z > viewBounds.maxZ
        ) {
          continue;
        }
        if (MAJOR_POI_ICONS.has(poi.icon)) majorPoisList.push(poi);
        else minorPoisList.push(poi);
      }

      const placedPlaceIds = new Set<string>();
      const placedStationIds = new Set<string>();
      const placedPoiIds = new Set<string>();

      const tryPlaceSettlement = (place: MapPlaceLabel, tierRank: number, forceInteractive = false) => {
        if (placedPlaceIds.has(place.id)) return;
        const isSelectedPlace = place.id === selectedPlaceId;
        const isMultiSelectedPlace = !st.photoMode && multiSelectedPlaceSet.has(place.id);
        const isHoveredPlace = place.id === hoveredPlaceId;
        const baseAlpha =
          place.tier === 'village' ? lod.opacity.villages : lod.opacity.settlements;
        const rawAlpha =
          isSelectedPlace || isMultiSelectedPlace || isHoveredPlace
            ? 1
            : isPlaceEditMode
            ? Math.max(baseAlpha, 0.78)
            : baseAlpha;
        if (rawAlpha <= 0.02) return;

        const p = proj(place.x, place.z, 0);
        if (p.sx < -110 || p.sx > width + 110 || p.sy < -50 || p.sy > height + 50) return;

        const isCity = place.tier === 'city';
        const isTown = place.tier === 'town';
        const fontSize = isCity
          ? lod.tier === 'regional'
            ? 14.5
            : 16
          : isTown
          ? 12.5
          : 11;
        const fontStr = `${isCity ? '800' : isTown ? '700' : '600'} ${fontSize}px Manrope, sans-serif`;
        ctx.font = fontStr;
        const textW = ctx.measureText(place.name).width;
        const dotR = isCity ? 4.2 : isTown ? 3.2 : 2.4;
        const showSubtitle = Boolean(
          place.subtitle && (lod.tier === 'regional' || isSelectedPlace || isMultiSelectedPlace || isPlaceEditMode)
        );
        const baseLabelY = p.sy - dotR - (showSubtitle ? 16 : 9);
        const rawBoxX1 = p.sx - Math.max(textW * 0.5, 16) - 6;
        const rawBoxY1 = baseLabelY - 10;
        const rawBoxX2 = p.sx + Math.max(textW * 0.5, 16) + 6;
        const rawBoxY2 = p.sy + dotR + 5;
        const pinExact =
          forceInteractive ||
          isSelectedPlace ||
          isMultiSelectedPlace ||
          isHoveredPlace ||
          isPlaceEditMode ||
          (isCity && place.priority >= 95);

        const dy = resolvePlaceVerticalOffset(rawBoxX1, rawBoxY1, rawBoxX2, rawBoxY2, pinExact);
        const dotY = p.sy + dy;
        const labelY = baseLabelY + dy;
        const boxX1 = rawBoxX1;
        const boxY1 = rawBoxY1 + dy;
        const boxX2 = rawBoxX2;
        const boxY2 = rawBoxY2 + dy;
        placedPlaceIds.add(place.id);

        renderedPlaceHitsRef.current.push({
          place,
          x1: boxX1,
          y1: boxY1,
          x2: boxX2,
          y2: boxY2,
          cx: p.sx,
          cy: dotY,
        });

        const anim = elementAnimator.getProgress(
          `place:${place.id}`,
          now,
          isSelectedPlace ||
            isMultiSelectedPlace ||
            isHoveredPlace ||
            (isCity && place.priority >= 95 && lod.tier === 'regional')
        );
        const finalAlpha = rawAlpha * anim;

        placedDrawOps.push({
          priorityTier: tierRank,
          draw: () => {
            ctx.save();
            ctx.globalAlpha = finalAlpha;
            applyPopInTransform(p.sx, dotY, anim);

            if (isMultiSelectedPlace) {
              ctx.beginPath();
              ctx.roundRect(boxX1 - 3, boxY1 - 2, boxX2 - boxX1 + 6, boxY2 - boxY1 + 4, 8);
              ctx.fillStyle = 'rgba(2, 132, 199, 0.22)';
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.setLineDash([4, 3]);
              ctx.strokeStyle = '#0284C7';
              ctx.stroke();
              ctx.setLineDash([]);
            } else if (isSelectedPlace || isHoveredPlace) {
              ctx.beginPath();
              ctx.roundRect(boxX1 - 2, boxY1 - 1, boxX2 - boxX1 + 4, boxY2 - boxY1 + 2, 8);
              ctx.fillStyle = isSelectedPlace
                ? 'rgba(255, 204, 0, 0.22)'
                : 'rgba(255, 204, 0, 0.12)';
              ctx.fill();
              ctx.lineWidth = isSelectedPlace ? 2 : 1.4;
              ctx.setLineDash([4, 3]);
              ctx.strokeStyle = isSelectedPlace ? '#F59E0B' : '#EAB308';
              ctx.stroke();
              ctx.setLineDash([]);
            } else if (isPlaceEditMode) {
              ctx.beginPath();
              ctx.arc(p.sx, dotY, dotR + 4.5, 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
              ctx.lineWidth = 1.4;
              ctx.setLineDash([3, 2]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            ctx.beginPath();
            ctx.arc(p.sx, dotY, dotR, 0, Math.PI * 2);
            ctx.fillStyle = isSelectedPlace ? '#FFCC00' : isDark ? '#0F172A' : '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = isCity ? 2.2 : 1.7;
            ctx.strokeStyle = isSelectedPlace ? '#B45309' : isDark ? '#F8FAFC' : '#1E293B';
            ctx.stroke();

            ctx.font = fontStr;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = isCity ? 4.2 : 3.4;
            ctx.strokeStyle = isDark ? 'rgba(13, 16, 23, 0.94)' : 'rgba(255, 255, 255, 0.96)';
            ctx.strokeText(place.name, p.sx, labelY);
            ctx.fillStyle = isSelectedPlace
              ? isDark
                ? '#FDE047'
                : '#9A3412'
              : isDark
              ? isCity
                ? '#FFFFFF'
                : isTown
                ? '#E2E8F0'
                : '#CBD5E1'
              : isCity
              ? '#0F172A'
              : isTown
              ? '#1E293B'
              : '#334155';
            ctx.fillText(place.name, p.sx, labelY);

            if (showSubtitle && place.subtitle) {
              ctx.font = '500 10px Manrope, sans-serif';
              ctx.lineWidth = 2.6;
              ctx.strokeText(place.subtitle, p.sx, labelY + 11.5);
              ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
              ctx.fillText(place.subtitle, p.sx, labelY + 11.5);
            }
            ctx.restore();
          },
        });
      };

      const tryPlaceDistrict = (dist: MapPlaceLabel, tierRank: number, forceInteractive = false) => {
        if (placedPlaceIds.has(dist.id)) return;
        const isSelectedPlace = dist.id === selectedPlaceId;
        const isMultiSelectedPlace = !st.photoMode && multiSelectedPlaceSet.has(dist.id);
        const isHoveredPlace = dist.id === hoveredPlaceId;
        const baseAlpha = lod.opacity.districts;
        const rawAlpha =
          isSelectedPlace || isMultiSelectedPlace || isHoveredPlace
            ? 1
            : isPlaceEditMode
            ? Math.max(baseAlpha * 0.8, 0.76)
            : baseAlpha * 0.8;
        // District labels remain continuously visible throughout their active zoom band (never culled during pan/zoom)
        if (rawAlpha <= 0.02) return;

        const p = proj(dist.x, dist.z, 0);
        if (p.sx < -110 || p.sx > width + 110 || p.sy < -40 || p.sy > height + 40) return;

        const labelText = dist.name.toUpperCase();
        ctx.font = '700 10.5px Manrope, sans-serif';
        const textW = ctx.measureText(labelText).width;
        const hasSub = Boolean(
          dist.subtitle && (isSelectedPlace || isMultiSelectedPlace || isPlaceEditMode || cam.zoom < 0.35)
        );
        const rawBoxX1 = p.sx - textW * 0.5 - 6;
        const rawBoxY1 = p.sy - 9;
        const rawBoxX2 = p.sx + textW * 0.5 + 6;
        const rawBoxY2 = p.sy + (hasSub ? 18 : 9);
        const pinExact =
          forceInteractive || isSelectedPlace || isMultiSelectedPlace || isHoveredPlace || isPlaceEditMode;

        const dy = resolvePlaceVerticalOffset(rawBoxX1, rawBoxY1, rawBoxX2, rawBoxY2, pinExact);
        const drawY = p.sy + dy;
        const boxX1 = rawBoxX1;
        const boxY1 = rawBoxY1 + dy;
        const boxX2 = rawBoxX2;
        const boxY2 = rawBoxY2 + dy;
        placedPlaceIds.add(dist.id);

        renderedPlaceHitsRef.current.push({
          place: dist,
          x1: boxX1,
          y1: boxY1,
          x2: boxX2,
          y2: boxY2,
          cx: p.sx,
          cy: drawY,
        });

        const anim = elementAnimator.getProgress(
          `place:${dist.id}`,
          now,
          isSelectedPlace || isMultiSelectedPlace || isHoveredPlace
        );
        const finalAlpha = rawAlpha * anim;

        placedDrawOps.push({
          priorityTier: tierRank,
          draw: () => {
            ctx.save();
            ctx.globalAlpha = finalAlpha;
            applyPopInTransform(p.sx, drawY, anim);
            if (isMultiSelectedPlace) {
              ctx.beginPath();
              ctx.roundRect(boxX1 - 3, boxY1 - 2, boxX2 - boxX1 + 6, boxY2 - boxY1 + 4, 7);
              ctx.fillStyle = 'rgba(2, 132, 199, 0.22)';
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.setLineDash([4, 3]);
              ctx.strokeStyle = '#0284C7';
              ctx.stroke();
              ctx.setLineDash([]);
            } else if (isSelectedPlace || isHoveredPlace || isPlaceEditMode) {
              ctx.beginPath();
              ctx.roundRect(boxX1 - 2, boxY1 - 1, boxX2 - boxX1 + 4, boxY2 - boxY1 + 2, 7);
              ctx.fillStyle = isSelectedPlace
                ? 'rgba(255, 204, 0, 0.24)'
                : isHoveredPlace
                ? 'rgba(255, 204, 0, 0.14)'
                : isDark
                ? 'rgba(30, 41, 59, 0.36)'
                : 'rgba(255, 255, 255, 0.5)';
              ctx.fill();
              ctx.lineWidth = isSelectedPlace ? 1.9 : 1.2;
              ctx.setLineDash([4, 3]);
              ctx.strokeStyle = isSelectedPlace
                ? '#F59E0B'
                : isHoveredPlace
                ? '#EAB308'
                : 'rgba(148, 163, 184, 0.55)';
              ctx.stroke();
              ctx.setLineDash([]);
            }
            ctx.font = '700 10.5px Manrope, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.strokeStyle = isDark ? 'rgba(15, 18, 25, 0.78)' : 'rgba(255, 255, 255, 0.82)';
            ctx.strokeText(labelText, p.sx, drawY);
            ctx.fillStyle = isSelectedPlace
              ? isDark
                ? '#FDE047'
                : '#9A3412'
              : isDark
              ? 'rgba(148, 163, 184, 0.76)'
              : 'rgba(71, 85, 105, 0.74)';
            ctx.fillText(labelText, p.sx, drawY);

            if (hasSub && dist.subtitle) {
              ctx.font = '500 9.5px Manrope, sans-serif';
              ctx.lineWidth = 2.4;
              ctx.strokeText(dist.subtitle, p.sx, drawY + 11.5);
              ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.7)' : 'rgba(100, 116, 139, 0.74)';
              ctx.fillText(dist.subtitle, p.sx, drawY + 11.5);
            }
            ctx.restore();
          },
        });
      };

      const tryPlaceStation = (
        station: MtrStation,
        tierRank: number,
        dedupRadiusPx: number,
        forceInteractive = false
      ) => {
        if (placedStationIds.has(station.id)) return;
        const isMetro = station.kinds.includes('metro');
        const isRail = station.kinds.includes('rail');
        const isSelected = !st.photoMode && station.id === selectedStationId;
        const isHovered = !st.photoMode && station.id === hoveredStationId;
        const stAlpha =
          isSelected || isHovered
            ? 1
            : isMetro || isRail
            ? lod.opacity.metroRailStations
            : lod.opacity.surfaceStations;
        if (stAlpha <= 0.02) return;

        const elev = useElevY
          ? Math.max(-18, Math.min(72, station.y - SERVER_GROUND_Y + 2))
          : is3D
          ? 2
          : 0;
        const p = proj(station.x, station.z, elev);
        if (p.sx < -36 || p.sx > width + 36 || p.sy < -36 || p.sy > height + 36) return;

        const normName = normalizeStationNameForDedup(station.name);
        if (!forceInteractive && !isSelected && !isHovered && isDuplicateStationNear(normName, p.sx, p.sy, dedupRadiusPx)) {
          return;
        }

        const nearbyModes = st.stationCombinedModesMap.get(station.id) ?? [];
        const resolvedSymbol = resolveStationStopSymbol(station, nearbyModes);
        const { halfW, halfH } = getTransitStopSymbolHalfExtents(resolvedSymbol, {
          zoom: cam.zoom,
          isSelected,
          isHovered,
        });

        // CRITICAL FIX: Test icon bounding box against labelGrid BEFORE placing!
        // Prevents smaller-scale rail/bus/tram icons from ever painting over Metro emblems or higher-priority labels!
        const iconPad = isMetro ? 3.5 : isRail ? 2.5 : 2;
        const iconX1 = p.sx - halfW - iconPad;
        const iconY1 = p.sy - halfH - iconPad;
        const iconX2 = p.sx + halfW + iconPad;
        const iconY2 = p.sy + halfH + iconPad;
        const forceIcon = forceInteractive || isSelected || isHovered;
        if (!forceIcon && !labelGrid.canPlace(iconX1, iconY1, iconX2, iconY2)) {
          return;
        }
        labelGrid.reserve(iconX1, iconY1, iconX2, iconY2);
        placedStationIds.add(station.id);
        recordPlacedStationName(normName, p.sx, p.sy);

        // Try smart 8-anchor label placement strictly outside the reserved icon box (zero self-collision!)
        const stLabelAlpha =
          isMetro || isRail || isSelected || isHovered
            ? stAlpha
            : Math.min(stAlpha, lod.opacity.surfaceStationLabels);
        const fontStr =
          isMetro || isRail
            ? '700 11.5px Manrope, sans-serif'
            : '500 10.5px Manrope, sans-serif';
        let chosenLabel: { tx: number; ty: number; align: CanvasTextAlign } | null = null;
        if (stLabelAlpha > 0.02) {
          ctx.font = fontStr;
          const textW = ctx.measureText(station.name).width;
          const candidates = buildIconLabelCandidates(p.sx, p.sy, halfW, halfH, iconPad, textW, 8.5);
          const winIdx = tryPlaceLabelCandidates(
            candidates.map((c) => c.box),
            isSelected || isHovered
          );
          if (winIdx >= 0) {
            chosenLabel = {
              tx: candidates[winIdx].tx,
              ty: candidates[winIdx].ty,
              align: candidates[winIdx].align,
            };
          }
        }

        const iconAnim = elementAnimator.getProgress(`station:${station.id}`, now, isSelected || isHovered);
        const lblAnim = chosenLabel
          ? elementAnimator.getProgress(`station-lbl:${station.id}`, now, isSelected || isHovered)
          : 0;

        placedDrawOps.push({
          priorityTier: tierRank,
          draw: () => {
            ctx.save();
            const iconFinalAlpha = stAlpha * iconAnim;
            if (iconFinalAlpha < 0.995) ctx.globalAlpha = iconFinalAlpha;
            applyPopInTransform(p.sx, p.sy, iconAnim);

            if (useElevY && Math.abs(station.y - SERVER_GROUND_Y) >= 8 && !isInteracting) {
              const gp = proj(station.x, station.z, 0);
              ctx.beginPath();
              ctx.moveTo(gp.sx, gp.sy);
              ctx.lineTo(p.sx, p.sy);
              ctx.strokeStyle = isDark ? 'rgba(203,213,225,0.45)' : 'rgba(71,85,105,0.38)';
              ctx.lineWidth = 1.4;
              ctx.setLineDash([2, 2]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            const showDraggableRing =
              !st.photoMode &&
              st.isEditorMode &&
              (st.editorTool === 'move-transit' || isSelected);
            if (showDraggableRing) {
              ctx.beginPath();
              ctx.arc(p.sx, p.sy, isMetro || isRail ? 14 : 10.5, 0, Math.PI * 2);
              ctx.strokeStyle = isSelected || isHovered ? '#FFCC00' : 'rgba(255,204,0,0.55)';
              ctx.lineWidth = isSelected || isHovered ? 2.4 : 1.5;
              ctx.setLineDash([3, 2]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            drawTransitStopSymbolOnCanvas(ctx, p.sx, p.sy, resolvedSymbol, {
              zoom: cam.zoom,
              isSelected,
              isHovered,
              isDark,
            });
            ctx.restore();

            if (chosenLabel && stLabelAlpha * lblAnim > 0.02) {
              ctx.save();
              const labelFinalAlpha = stLabelAlpha * lblAnim;
              if (labelFinalAlpha < 0.995) ctx.globalAlpha = labelFinalAlpha;
              ctx.font = fontStr;
              ctx.textAlign = chosenLabel.align;
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3.2;
              ctx.strokeStyle = isDark ? 'rgba(25,27,32,0.92)' : 'rgba(255,255,255,0.95)';
              ctx.strokeText(station.name, chosenLabel.tx, chosenLabel.ty);
              ctx.fillStyle = isDark ? '#F3F4F6' : '#1A1C20';
              ctx.fillText(station.name, chosenLabel.tx, chosenLabel.ty);
              ctx.restore();
            }
          },
        });
      };

      const tryPlacePoi = (poi: MapPoi, tierRank: number, forceInteractive = false) => {
        if (placedPoiIds.has(poi.id)) return;
        const isSelectedPoi = !st.photoMode && poi.id === selectedPoiId;
        const isMultiSelectedPoi = !st.photoMode && multiSelectedPoiSet.has(poi.id);
        const isHoveredPoi = !st.photoMode && poi.id === hoveredPoiId;
        const poiAlpha =
          isSelectedPoi || isMultiSelectedPoi || isHoveredPoi
            ? 1
            : MAJOR_POI_ICONS.has(poi.icon)
            ? lod.opacity.majorPois
            : lod.opacity.minorPois;
        if (poiAlpha <= 0.02) return;

        const poiElev =
          useElevY && typeof poi.y === 'number'
            ? Math.max(-18, Math.min(72, poi.y - SERVER_GROUND_Y + 2))
            : is3D
            ? 4
            : 0;
        const p = proj(poi.x, poi.z, poiElev);
        if (p.sx < -30 || p.sx > width + 30 || p.sy < -30 || p.sy > height + 30) return;

        const badgeR = cam.zoom >= 0.45 ? 10.5 : 8.5;
        const poiPad = 2;
        const iconCy = p.sy - 8;
        const forcePoi = forceInteractive || isSelectedPoi || isMultiSelectedPoi || isHoveredPoi;
        if (
          !forcePoi &&
          !labelGrid.canPlace(
            p.sx - badgeR - poiPad,
            iconCy - badgeR - poiPad,
            p.sx + badgeR + poiPad,
            iconCy + badgeR + poiPad
          )
        ) {
          return;
        }
        labelGrid.reserve(
          p.sx - badgeR - poiPad,
          iconCy - badgeR - poiPad,
          p.sx + badgeR + poiPad,
          iconCy + badgeR + poiPad
        );
        placedPoiIds.add(poi.id);

        const poiLabelAlpha =
          isSelectedPoi || isHoveredPoi ? 1 : Math.min(poiAlpha, lod.opacity.poiLabels);
        let chosenPoiLabel: { tx: number; ty: number; align: CanvasTextAlign } | null = null;
        if (poiLabelAlpha > 0.02 && (!isInteracting || isSelectedPoi || isHoveredPoi)) {
          ctx.font = '700 11px Manrope, sans-serif';
          const textW = ctx.measureText(poi.name).width;
          const candidates = buildIconLabelCandidates(p.sx, iconCy, badgeR, badgeR, poiPad, textW, 8);
          const winIdx = tryPlaceLabelCandidates(
            candidates.map((c) => c.box),
            isSelectedPoi || isHoveredPoi
          );
          if (winIdx >= 0) {
            chosenPoiLabel = {
              tx: candidates[winIdx].tx,
              ty: candidates[winIdx].ty,
              align: candidates[winIdx].align,
            };
          }
        }

        const isEraserHoverPoi = st.editorTool === 'delete-area' && isHoveredPoi;
        const poiAnim = elementAnimator.getProgress(`poi:${poi.id}`, now, forcePoi);
        const poiLblAnim = chosenPoiLabel
          ? elementAnimator.getProgress(`poi-lbl:${poi.id}`, now, forcePoi)
          : 0;

        placedDrawOps.push({
          priorityTier: tierRank,
          draw: () => {
            ctx.save();
            const finalPoiAlpha = poiAlpha * poiAnim;
            if (finalPoiAlpha < 0.995) ctx.globalAlpha = finalPoiAlpha;
            applyPopInTransform(p.sx, iconCy, poiAnim);
            if (isMultiSelectedPoi) {
              ctx.beginPath();
              ctx.arc(p.sx, iconCy, 15, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(2, 132, 199, 0.25)';
              ctx.fill();
              ctx.lineWidth = 2.2;
              ctx.strokeStyle = '#0284C7';
              ctx.stroke();
            }
            drawMapSymbolBadge(ctx, p.sx, iconCy, poi.icon, {
              color: isEraserHoverPoi ? '#DC2626' : poi.color,
              radius: badgeR,
              isSelected: isSelectedPoi || isMultiSelectedPoi,
              isHovered: isHoveredPoi,
              isStandalone: true,
              isDark,
            });
            ctx.restore();

            if (chosenPoiLabel && poiLabelAlpha * poiLblAnim > 0.02) {
              ctx.save();
              const finalLblAlpha = poiLabelAlpha * poiLblAnim;
              if (finalLblAlpha < 0.995) ctx.globalAlpha = finalLblAlpha;
              ctx.font = '700 11px Manrope, sans-serif';
              ctx.textAlign = chosenPoiLabel.align;
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3.2;
              ctx.strokeStyle = isDark ? 'rgba(20,22,28,0.92)' : 'rgba(255,255,255,0.95)';
              ctx.strokeText(poi.name, chosenPoiLabel.tx, chosenPoiLabel.ty);
              ctx.fillStyle = isDark ? '#F8FAFC' : '#18181B';
              ctx.fillText(poi.name, chosenPoiLabel.tx, chosenPoiLabel.ty);
              ctx.restore();
            }
          },
        });
      };

      // --- TIER 100: Interactive Priority (Selected / Hovered / Multi-Selected items ALWAYS win and render on top) ---
      for (let i = 0; i < settlementPlaces.length; i++) {
        if (
          settlementPlaces[i].id === selectedPlaceId ||
          settlementPlaces[i].id === hoveredPlaceId ||
          multiSelectedPlaceSet.has(settlementPlaces[i].id)
        ) {
          tryPlaceSettlement(settlementPlaces[i], 100, true);
        }
      }
      for (let i = 0; i < districtPlaces.length; i++) {
        if (
          districtPlaces[i].id === selectedPlaceId ||
          districtPlaces[i].id === hoveredPlaceId ||
          multiSelectedPlaceSet.has(districtPlaces[i].id)
        ) {
          tryPlaceDistrict(districtPlaces[i], 100, true);
        }
      }
      for (let i = 0; i < visibleStations.length; i++) {
        const s = visibleStations[i];
        if (s.id === selectedStationId || s.id === hoveredStationId) {
          tryPlaceStation(s, 100, 0, true);
        }
      }
      for (let i = 0; i < st.pois.length; i++) {
        const poi = st.pois[i];
        if (poi.id === selectedPoiId || poi.id === hoveredPoiId || multiSelectedPoiSet.has(poi.id)) {
          tryPlacePoi(poi, 100, true);
        }
      }

      // --- TIER 94..90: Macro Settlements (Cities > Towns > Villages — ALWAYS visible & on top) ---
      for (let i = 0; i < settlementPlaces.length; i++) {
        const pl = settlementPlaces[i];
        const subRank = pl.tier === 'city' ? 94 : pl.tier === 'town' ? 92 : 90;
        tryPlaceSettlement(pl, subRank, false);
      }

      // --- TIER 86: Urban Districts & Neighborhoods (ALWAYS above stations, stops, lines & buildings) ---
      for (let i = 0; i < districtPlaces.length; i++) {
        tryPlaceDistrict(districtPlaces[i], 86, false);
      }

      // --- TIER 80: Metro Stations (highest transit scale — never covered by rail/surface stops) ---
      for (let i = 0; i < metroStations.length; i++) {
        tryPlaceStation(metroStations[i], 80, 68, false);
      }

      // --- TIER 68: Regional Rail Stations ---
      for (let i = 0; i < railStations.length; i++) {
        tryPlaceStation(railStations[i], 68, 56, false);
      }

      // --- TIER 54: Major Landmarks / POIs ---
      for (let i = 0; i < majorPoisList.length; i++) {
        tryPlacePoi(majorPoisList[i], 54, false);
      }

      // --- TIER 42: Surface Transit Stops (Cable, Boat, Plane, Tram, Trolleybus, Bus) ---
      for (let i = 0; i < surfaceStationsList.length; i++) {
        tryPlaceStation(surfaceStationsList[i], 42, 44, false);
      }

      // --- TIER 35: Land Feature Labels (Water bodies, Parks, Plazas — strictly interior & auto-rotated) ---
      if (deferredLandLabels.length > 0) {
        for (let i = 0; i < deferredLandLabels.length; i++) {
          const ll = deferredLandLabels[i];
          const fontStr =
            ll.kind === 'water'
              ? `italic 600 ${ll.isRegional ? 12 : 11}px Manrope, sans-serif`
              : '600 10.5px Manrope, sans-serif';
          ctx.font = fontStr;
          const tw = ctx.measureText(ll.name).width;
          const cosA = Math.abs(Math.cos(ll.angle));
          const sinA = Math.abs(Math.sin(ll.angle));
          const halfW = cosA * (tw * 0.5 + 4) + sinA * 8;
          const halfH = sinA * (tw * 0.5 + 4) + cosA * 8;
          if (!tryPlaceSingleLabel(ll.sx - halfW, ll.sy - halfH, ll.sx + halfW, ll.sy + halfH)) {
            continue;
          }
          const finalAlpha = ll.alpha;
          if (finalAlpha <= 0.01) continue;
          placedDrawOps.push({
            priorityTier: 35,
            draw: () => {
              ctx.save();
              if (finalAlpha < 0.995) ctx.globalAlpha = finalAlpha;
              ctx.translate(ll.sx, ll.sy);
              if (Math.abs(ll.angle) > 0.01) ctx.rotate(ll.angle);
              if (ll.scale < 0.998) ctx.scale(ll.scale, ll.scale);
              ctx.font = fontStr;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3;
              ctx.strokeStyle = isDark ? 'rgba(18,22,30,0.86)' : 'rgba(255,255,255,0.88)';
              ctx.strokeText(ll.name, 0, 0);
              ctx.fillStyle =
                ll.kind === 'water'
                  ? isDark
                    ? '#7DD3FC'
                    : '#1D6FA5'
                  : ll.kind === 'park'
                  ? isDark
                    ? '#86EFAC'
                    : '#3A743B'
                  : isDark
                  ? '#CBD5E1'
                  : '#64748B';
              ctx.fillText(ll.name, 0, 0);
              ctx.restore();
            },
          });
        }
      }

      // --- TIER 30: Street & Highway Name Labels (Major roads first, then minor streets) ---
      if (deferredStreetLabels.length > 0) {
        deferredStreetLabels.sort((a, b) => Number(b.isMajor) - Number(a.isMajor));
        for (let i = 0; i < deferredStreetLabels.length; i++) {
          const sl = deferredStreetLabels[i];
          const fontStr =
            sl.roadClass === 'highway'
              ? '700 11px Manrope, sans-serif'
              : sl.isMajor
              ? '600 10.5px Manrope, sans-serif'
              : '500 10px Manrope, sans-serif';
          ctx.font = fontStr;
          const tw = ctx.measureText(sl.name).width;
          const halfW = Math.abs(Math.cos(sl.angle)) * (tw * 0.5 + 4) + Math.abs(Math.sin(sl.angle)) * 8;
          const halfH = Math.abs(Math.sin(sl.angle)) * (tw * 0.5 + 4) + Math.abs(Math.cos(sl.angle)) * 8;
          if (!tryPlaceSingleLabel(sl.mx - halfW, sl.my - halfH, sl.mx + halfW, sl.my + halfH)) {
            continue;
          }
          const anim = elementAnimator.getProgress(sl.key, now);
          const finalAlpha = sl.alpha * anim;
          placedDrawOps.push({
            priorityTier: sl.isMajor ? 32 : 28,
            draw: () => {
              ctx.save();
              if (finalAlpha < 0.995) ctx.globalAlpha = finalAlpha;
              ctx.translate(sl.mx, sl.my);
              ctx.rotate(sl.angle);
              ctx.font = fontStr;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3;
              ctx.strokeStyle = isDark ? 'rgba(20,22,28,0.9)' : 'rgba(255,255,255,0.92)';
              ctx.strokeText(sl.name, 0, 0);
              ctx.fillStyle = isDark ? '#E2E8F0' : '#4A463B';
              ctx.fillText(sl.name, 0, 0);
              ctx.restore();
            },
          });
        }
      }

      // --- TIER 20: Minor POIs ---
      for (let i = 0; i < minorPoisList.length; i++) {
        tryPlacePoi(minorPoisList[i], 20, false);
      }

      // --- TIER 10: Building Category Symbols, House Numbers & Landmark Building Names ---
      if (deferredBuildingAnnotations.length > 0) {
        deferredBuildingAnnotations.sort((a, b) => {
          const aPri = (a.isSelected || a.isHovered ? 2 : 0) + (a.building.category !== 'residential' ? 1 : 0);
          const bPri = (b.isSelected || b.isHovered ? 2 : 0) + (b.building.category !== 'residential' ? 1 : 0);
          return bPri - aPri;
        });

        for (let i = 0; i < deferredBuildingAnnotations.length; i++) {
          const ann = deferredBuildingAnnotations[i];
          const b = ann.building;
          const isSelected = ann.isSelected;
          const isHovered = ann.isHovered;
          const iconKind = resolveBuildingIconKind(b);
          const isNotableSymbol =
            Boolean(b.icon) || (b.category !== 'residential' && iconKind !== 'residential');

          const bldgIconAlpha = isSelected || isHovered ? 1 : lod.opacity.buildingIcons;
          const showSymbol =
            isNotableSymbol &&
            bldgIconAlpha > 0.02 &&
            (isSelected || isHovered || ann.roofSpanPx >= 16);

          let symbolPlaced = false;
          if (showSymbol) {
            const symY = ann.sy - (st.layers.addressNumbers ? 4 : 0);
            symbolPlaced = tryPlaceSingleLabel(
              ann.sx - 10,
              symY - 10,
              ann.sx + 10,
              symY + 10,
              isSelected || isHovered
            );
            if (symbolPlaced) {
              const anim = elementAnimator.getProgress(`bldg-ico:${b.id}`, now, isSelected || isHovered);
              const finalAlpha = bldgIconAlpha * anim * ann.wingAnim;
              placedDrawOps.push({
                priorityTier: isSelected || isHovered ? 96 : 16,
                draw: () => {
                  ctx.save();
                  if (finalAlpha < 0.995) ctx.globalAlpha = finalAlpha;
                  applyPopInTransform(ann.sx, symY, anim);
                  drawMapSymbolBadge(ctx, ann.sx, symY, iconKind, {
                    radius: cam.zoom >= 0.6 ? 8.5 : 7.4,
                    isSelected,
                    isHovered,
                    isStandalone: false,
                    isDark,
                  });
                  ctx.restore();
                },
              });
            }
          }

          const houseNumAlpha = isSelected || isHovered ? 1 : lod.opacity.houseNumbers;
          if (st.layers.addressNumbers && houseNumAlpha > 0.02 && b.houseNumber) {
            const showNumber =
              isSelected ||
              isHovered ||
              (!b.isAutoSynthesized && ann.roofSpanPx >= 14) ||
              (b.isAutoSynthesized && cam.zoom >= 0.52 && ann.roofSpanPx >= 24);

            if (showNumber) {
              const numY = symbolPlaced ? ann.sy + 11 : ann.sy;
              ctx.font = '600 10px "JetBrains Mono", monospace';
              const numW = ctx.measureText(b.houseNumber).width;
              const numPlaced = tryPlaceSingleLabel(
                ann.sx - numW * 0.5 - 2,
                numY - 6,
                ann.sx + numW * 0.5 + 2,
                numY + 6,
                isSelected || isHovered
              );
              if (numPlaced) {
                const anim = elementAnimator.getProgress(`bldg-num:${b.id}`, now, isSelected || isHovered);
                const finalAlpha = houseNumAlpha * anim * ann.wingAnim;
                const drawHalo = isHybrid || symbolPlaced;
                placedDrawOps.push({
                  priorityTier: isSelected || isHovered ? 95 : 12,
                  draw: () => {
                    ctx.save();
                    if (finalAlpha < 0.995) ctx.globalAlpha = finalAlpha;
                    ctx.font = '600 10px "JetBrains Mono", monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    if (drawHalo) {
                      ctx.lineWidth = 2.6;
                      ctx.strokeStyle = isDark ? 'rgba(15,17,22,0.88)' : 'rgba(255,255,255,0.92)';
                      ctx.strokeText(b.houseNumber, ann.sx, numY);
                    }
                    ctx.fillStyle = isSelected
                      ? isDark
                        ? '#FFCC00'
                        : '#B91C1C'
                      : isDark
                      ? '#CBD5E1'
                      : '#524E45';
                    ctx.fillText(b.houseNumber, ann.sx, numY);
                    ctx.restore();
                  },
                });
              }
            }
          }

          const bldgNameAlpha = lod.opacity.buildingNames;
          if (
            bldgNameAlpha > 0.02 &&
            isNotableSymbol &&
            b.name &&
            b.name.length >= 3 &&
            !/^(Жилой дом|Дом|Строение|Угловое строение|Параллелепипед)\b/i.test(b.name)
          ) {
            ctx.font = '600 10.5px Manrope, sans-serif';
            const nameW = ctx.measureText(b.name).width;
            const ny = symbolPlaced ? ann.sy + 23 : ann.sy + 14;
            if (
              tryPlaceSingleLabel(
                ann.sx - nameW * 0.5 - 3,
                ny - 7,
                ann.sx + nameW * 0.5 + 3,
                ny + 7,
                isSelected
              )
            ) {
              const anim = elementAnimator.getProgress(`bldg-name:${b.id}`, now, isSelected);
              const finalAlpha = bldgNameAlpha * anim * ann.wingAnim;
              placedDrawOps.push({
                priorityTier: isSelected ? 94 : 10,
                draw: () => {
                  ctx.save();
                  if (finalAlpha < 0.995) ctx.globalAlpha = finalAlpha;
                  ctx.font = '600 10.5px Manrope, sans-serif';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.lineWidth = 2.8;
                  ctx.strokeStyle = isDark ? 'rgba(15,17,22,0.9)' : 'rgba(255,255,255,0.94)';
                  ctx.strokeText(b.name, ann.sx, ny);
                  ctx.fillStyle = isDark ? '#E2E8F0' : '#334155';
                  ctx.fillText(b.name, ann.sx, ny);
                  ctx.restore();
                },
              });
            }
          }
        }
      }

      // Render all placed labels & symbols in ascending priority order (lowest scale FIRST -> highest scale LAST)
      // so higher-scale cartographic elements always remain crisp and completely unobstructed!
      placedDrawOps.sort((a, b) => a.priorityTier - b.priorityTier);
      for (let i = 0; i < placedDrawOps.length; i++) {
        placedDrawOps[i].draw();
      }

      // 10. Route Endpoint Pins (Red 'А' and Blue 'Б')
      const drawPin = (pt: RouteEndpoint, label: string, fill: string) => {
        const p = proj(pt.x, pt.z, is3D ? 4 : 0);
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.beginPath();
        ctx.ellipse(0, 2, 7, 3, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, -18, 12, Math.PI * 0.82, Math.PI * 2.18, false);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();

        ctx.font = '700 11px Manrope, sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, -18);
        ctx.restore();
      };

      if (st.pointA) drawPin(st.pointA, 'А', '#FC3F1D');
      if (st.pointB) drawPin(st.pointB, 'Б', '#2563EB');

      // 11. Selected arbitrary map point pin
      if (!st.photoMode && st.selectedEntity?.type === 'point') {
        const p = proj(st.selectedEntity.x, st.selectedEntity.z, 0);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#FFCC00';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#18181B';
        ctx.stroke();
      }

      // 12. Direct Interactive Handles for Selected Building (including Rotation ↻), Street, Land, or Transit Route
      const isMultiSelectVisualActive =
        st.isEditorMode &&
        st.editorTool === 'select' &&
        (st.multiSelectedItems.length >= 2 || (st.multiSelectMode && st.multiSelectedItems.length >= 1));
      const handles = st.photoMode || isMultiSelectVisualActive ? null : getSelectedHandles(width, height);
      if (
        !st.photoMode &&
        handles &&
        !st.isDrawingWing &&
        !st.mergeSourceBuildingId &&
        (st.editorTool === 'select' || st.editorTool === 'move-transit')
      ) {
        if (handles.kind === 'building' && st.editorTool === 'select') {
          // Stem + Rotation handle (↻)
          const rh = handles.rotateHandle;
          const sf = handles.rotateStemFrom;
          ctx.beginPath();
          ctx.moveTo(sf.sx, sf.sy);
          ctx.lineTo(rh.sx, rh.sy);
          ctx.strokeStyle = '#2563EB';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.beginPath();
          ctx.arc(rh.sx, rh.sy, 8.2, 0, Math.PI * 2);
          ctx.fillStyle = '#2563EB';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#FFFFFF';
          ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 11px Manrope, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('↻', rh.sx, rh.sy + 0.5);

          // Freeform sculpting handles (vertices + green '+' edge insertion handles) OR standard corner handles
          if (handles.isSculptMode) {
            for (const m of handles.midpoints) {
              ctx.beginPath();
              ctx.arc(m.sx, m.sy, 5.4, 0, Math.PI * 2);
              ctx.fillStyle = '#10B981';
              ctx.fill();
              ctx.lineWidth = 1.6;
              ctx.strokeStyle = '#FFFFFF';
              ctx.stroke();
              ctx.fillStyle = '#FFFFFF';
              ctx.font = '700 9px Manrope, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('+', m.sx, m.sy + 0.5);
            }
            for (const v of handles.vertices) {
              ctx.beginPath();
              ctx.arc(v.sx, v.sy, 6.2, 0, Math.PI * 2);
              ctx.fillStyle = '#FFFFFF';
              ctx.fill();
              ctx.lineWidth = 2.4;
              ctx.strokeStyle = '#059669';
              ctx.stroke();
            }
          } else {
            for (const c of handles.corners) {
              ctx.beginPath();
              ctx.arc(c.sx, c.sy, 6.2, 0, Math.PI * 2);
              ctx.fillStyle = '#FFCC00';
              ctx.fill();
              ctx.lineWidth = 2.2;
              ctx.strokeStyle = '#18181B';
              ctx.stroke();
            }
          }
          // Height handle (↕)
          const hh = handles.heightHandle;
          ctx.beginPath();
          ctx.arc(hh.sx, hh.sy, 7, 0, Math.PI * 2);
          ctx.fillStyle = '#FC3F1D';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#FFFFFF';
          ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 9px Manrope, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('↕', hh.sx, hh.sy + 0.5);
        } else if (handles.kind === 'street' && st.editorTool === 'select') {
          for (const v of handles.vertices) {
            ctx.beginPath();
            ctx.arc(v.sx, v.sy, 5.8, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = '#FC3F1D';
            ctx.stroke();
          }
          const wh = handles.widthHandle;
          ctx.beginPath();
          ctx.arc(wh.sx, wh.sy, 6.8, 0, Math.PI * 2);
          ctx.fillStyle = '#FFCC00';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#18181B';
          ctx.stroke();
          ctx.fillStyle = '#18181B';
          ctx.font = '700 9px Manrope, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('↔', wh.sx, wh.sy + 0.5);
        } else if (handles.kind === 'land' && st.editorTool === 'select') {
          for (const v of handles.vertices) {
            ctx.beginPath();
            ctx.arc(v.sx, v.sy, 5.8, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = '#10B981';
            ctx.stroke();
          }
        } else if (handles.kind === 'route') {
          for (const m of handles.midpoints) {
            ctx.beginPath();
            ctx.arc(m.sx, m.sy, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = '#FFCC00';
            ctx.fill();
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = '#18181B';
            ctx.stroke();
            ctx.fillStyle = '#18181B';
            ctx.font = '700 9px Manrope, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', m.sx, m.sy + 0.5);
          }
          for (const v of handles.vertices) {
            ctx.beginPath();
            ctx.arc(v.sx, v.sy, 6.2, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 2.4;
            ctx.strokeStyle = handles.route.color || '#FC3F1D';
            ctx.stroke();
          }
        }
      }

      // 13. User-Selected Arbitrary Polygon Synthesis Zone (with rubber-band preview & draggable vertices)
      const drag = dragRef.current;
      const showSynthPoly =
        !st.photoMode &&
        st.isEditorMode &&
        st.editorTool === 'synthesis' &&
        st.synthesisPolygon.length > 0;

      if (showSynthPoly) {
        const polyPts = st.synthesisPolygon.map((pt) => proj(pt.x, pt.z, 0));
        const closed = st.isSynthesisPolygonClosed && polyPts.length >= 3;
        const cw = cursorWorldRef.current;
        const cp = !closed && cw ? proj(cw.x, cw.z, 0) : null;

        ctx.save();
        if (polyPts.length >= 2) {
          ctx.beginPath();
          polyPts.forEach((p, idx) => {
            if (idx === 0) ctx.moveTo(p.sx, p.sy);
            else ctx.lineTo(p.sx, p.sy);
          });
          if (cp) ctx.lineTo(cp.sx, cp.sy);
          if (closed || (cp && polyPts.length >= 2)) {
            ctx.closePath();
            ctx.fillStyle = closed ? 'rgba(255, 204, 0, 0.13)' : 'rgba(255, 204, 0, 0.18)';
            ctx.fill();
          }
          ctx.setLineDash([7, 5]);
          ctx.strokeStyle = '#E5A800';
          ctx.lineWidth = 2.3;
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (polyPts.length === 1 && cp) {
          ctx.beginPath();
          ctx.moveTo(polyPts[0].sx, polyPts[0].sy);
          ctx.lineTo(cp.sx, cp.sy);
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = '#E5A800';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Draw vertices (vertex #0 glows green when ready to snap-close)
        for (let i = 0; i < polyPts.length; i++) {
          const v = polyPts[i];
          const isSnapOrigin = !closed && i === 0 && polyPts.length >= 3;
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, isSnapOrigin ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = isSnapOrigin ? '#10B981' : '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = 2.2;
          ctx.strokeStyle = isSnapOrigin ? '#FFFFFF' : '#D97706';
          ctx.stroke();
        }

        // Area / vertex count badge
        const areaSqM =
          st.synthesisPolygon.length >= 3 ? Math.round(computePolygonArea(st.synthesisPolygon)) : 0;
        const areaStr =
          areaSqM >= 1_000_000
            ? `${(areaSqM / 1_000_000).toFixed(2)} км²`
            : `${areaSqM.toLocaleString('ru-RU')} м²`;
        const labelText = closed
          ? `Зона синтеза: ${areaStr} · ${st.synthesisPolygon.length} верш.`
          : st.synthesisPolygon.length >= 3
          ? `Контур: ${st.synthesisPolygon.length} верш. (${areaStr}) · Enter или клик по 1-й точке`
          : `Контур синтеза: ${st.synthesisPolygon.length} / 3+ точек (Shift + ЛКМ)`;
        ctx.font = '700 11px Manrope, sans-serif';
        const tw = ctx.measureText(labelText).width + 14;
        const anchor = polyPts[0];
        const lx = Math.max(12, Math.min(width - tw - 12, anchor.sx));
        const ly = Math.max(12, Math.min(height - 28, anchor.sy - 28));
        ctx.fillStyle = 'rgba(24,24,27,0.92)';
        ctx.beginPath();
        ctx.roundRect(lx, ly, tw, 22, 6);
        ctx.fill();
        ctx.fillStyle = '#FFCC00';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, lx + 7, ly + 11.5);
        ctx.restore();
      }

      // 13b. Glowing magnetic building-to-building snap guide during free move or vertex sculpting
      if (!st.photoMode && snapGuideRef.current) {
        const [ga, gb] = snapGuideRef.current;
        const pa = proj(ga.x, ga.z, 0);
        const pb = proj(gb.x, gb.z, 0);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pa.sx, pa.sy, 4.5, 0, Math.PI * 2);
        ctx.arc(pb.sx, pb.sy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#6EE7B7';
        ctx.fill();
        ctx.restore();
      }

      // 14. Area-Drag Building / Wing Creation (with optional snap-to-building!), Freeform Polygon Drawing & Deletion Previews
      const isFreeformPolygonDrawMode =
        !st.photoMode &&
        (st.draftBuildingSize.shape ?? 'rect') === 'polygon' &&
        (st.editorTool === 'add-building' || st.isDrawingWing);

      if (isFreeformPolygonDrawMode) {
        const cw = cursorWorldRef.current;
        const snappedCursor =
          cw && st.snapToBuilding
            ? snapPointToBuildings(
                cw,
                st.buildings,
                undefined,
                undefined,
                Math.max(6, 12 / Math.max(0.12, cam.zoom))
              )
            : cw
            ? { x: cw.x, z: cw.z, snapped: false, snapGuide: undefined }
            : null;
        const h = Math.round(st.draftBuildingSize.floors * 4.2 + 3);
        const draftPts = st.draftBuildingPolygon ?? [];
        const roofPoly = draftPts.map((pt) => proj(pt.x, pt.z, is3D ? h : 0));
        const cp = snappedCursor ? proj(snappedCursor.x, snappedCursor.z, is3D ? h : 0) : null;

        ctx.save();
        if (roofPoly.length >= 2) {
          ctx.beginPath();
          roofPoly.forEach((p, idx) => {
            if (idx === 0) ctx.moveTo(p.sx, p.sy);
            else ctx.lineTo(p.sx, p.sy);
          });
          if (cp) ctx.lineTo(cp.sx, cp.sy);
          if (roofPoly.length >= 2) {
            ctx.closePath();
            ctx.fillStyle = st.isDrawingWing ? 'rgba(37, 99, 235, 0.28)' : 'rgba(16, 185, 129, 0.26)';
            ctx.fill();
          }
          ctx.strokeStyle = st.isDrawingWing ? '#2563EB' : '#059669';
          ctx.lineWidth = 2.4;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (roofPoly.length === 1 && cp) {
          ctx.beginPath();
          ctx.moveTo(roofPoly[0].sx, roofPoly[0].sy);
          ctx.lineTo(cp.sx, cp.sy);
          ctx.strokeStyle = st.isDrawingWing ? '#2563EB' : '#059669';
          ctx.lineWidth = 2.2;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Draw placed vertices (vertex #0 glows green when >= 3 pts for click-to-close)
        for (let i = 0; i < roofPoly.length; i++) {
          const p = roofPoly[i];
          const isCloseOrigin = i === 0 && roofPoly.length >= 3;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, isCloseOrigin ? 8 : 5.8, 0, Math.PI * 2);
          ctx.fillStyle = isCloseOrigin ? '#10B981' : '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = 2.2;
          ctx.strokeStyle = isCloseOrigin ? '#FFFFFF' : '#059669';
          ctx.stroke();
        }

        // Magnetic building snap ring under cursor
        if (cp) {
          ctx.beginPath();
          ctx.arc(cp.sx, cp.sy, snappedCursor?.snapped ? 7.5 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = snappedCursor?.snapped ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255, 204, 0, 0.55)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = snappedCursor?.snapped ? '#10B981' : '#FC3F1D';
          ctx.stroke();

          if (snappedCursor?.snapGuide) {
            const ga = proj(snappedCursor.snapGuide[0].x, snappedCursor.snapGuide[0].z, is3D ? h : 0);
            const gb = proj(snappedCursor.snapGuide[1].x, snappedCursor.snapGuide[1].z, is3D ? h : 0);
            ctx.beginPath();
            ctx.moveTo(ga.sx, ga.sy);
            ctx.lineTo(gb.sx, gb.sy);
            ctx.strokeStyle = '#10B981';
            ctx.lineWidth = 3;
            ctx.stroke();
          }

          const hint =
            draftPts.length >= 3
              ? `Полигон: ${draftPts.length} верш. · Enter или клик по 1-й точке${snappedCursor?.snapped ? ' · Стык' : ''}`
              : `Полигон: ${draftPts.length} / 3+ верш.${snappedCursor?.snapped ? ' · Привязка к зданию' : ''}`;
          ctx.font = '700 11px Manrope, sans-serif';
          const tw = ctx.measureText(hint).width + 14;
          const bx = Math.max(12, Math.min(width - tw - 12, cp.sx + 12));
          const by = Math.max(12, Math.min(height - 28, cp.sy - 26));
          ctx.fillStyle = 'rgba(24,24,27,0.9)';
          ctx.beginPath();
          ctx.roundRect(bx, by, tw, 21, 6);
          ctx.fill();
          ctx.fillStyle = snappedCursor?.snapped ? '#6EE7B7' : '#FFCC00';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(hint, bx + 7, by + 11);
        }
        ctx.restore();
      } else if (
        !st.photoMode &&
        drag.active &&
        (drag.mode === 'draw-building-area' || drag.mode === 'draw-wing-area') &&
        drag.moved
      ) {
        const snapped = snapBuildingRectToStreet(
          drag.startWorld,
          drag.currWorld,
          st.streets,
          st.snapToRoad,
          90,
          st.buildings,
          undefined,
          st.snapToBuilding
        );
        const h = Math.round(st.draftBuildingSize.floors * 4.2 + 3);
        const draftShape = st.draftBuildingSize.shape ?? 'rect';
        const previewFootprint =
          draftShape === 'triangle'
            ? createTriangleFootprint(
                snapped.x,
                snapped.z,
                snapped.width,
                snapped.depth,
                snapped.angleDeg,
                st.draftBuildingSize.triangleCorner ?? 0
              )
            : draftShape === 'circle'
            ? createCircleFootprint(
                snapped.x,
                snapped.z,
                snapped.width,
                snapped.depth,
                snapped.angleDeg
              )
            : draftShape === 'parallelogram'
            ? createParallelogramFootprint(
                snapped.x,
                snapped.z,
                snapped.width,
                snapped.depth,
                snapped.angleDeg,
                st.draftBuildingSize.skewDeg ?? 25
              )
            : snapped.footprint;
        const baseP = previewFootprint.map((pt) => proj(pt.x, pt.z, 0));
        const roofP = is3D ? previewFootprint.map((pt) => proj(pt.x, pt.z, h)) : baseP;

        if (snapped.snapped && snapped.snappedStreetId && !snapped.snappedEdge) {
          const stObj = st.streets.find((s) => s.id === snapped.snappedStreetId);
          if (stObj) {
            ctx.save();
            ctx.beginPath();
            stObj.points.forEach((pt, idx) => {
              const p = proj(pt.x, pt.z, 0);
              if (idx === 0) ctx.moveTo(p.sx, p.sy);
              else ctx.lineTo(p.sx, p.sy);
            });
            ctx.strokeStyle = 'rgba(255, 204, 0, 0.9)';
            ctx.lineWidth = Math.max(4, stObj.width * cam.zoom * 0.92 + 4);
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();
          }
        }

        // Flush building-to-building 0-gap contact guide line
        if (snapped.snappedEdge) {
          const ea = proj(snapped.snappedEdge[0].x, snapped.snappedEdge[0].z, is3D ? h : 0);
          const eb = proj(snapped.snappedEdge[1].x, snapped.snappedEdge[1].z, is3D ? h : 0);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(ea.sx, ea.sy);
          ctx.lineTo(eb.sx, eb.sy);
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.stroke();
          ctx.restore();
        }

        const isWing = drag.mode === 'draw-wing-area';
        ctx.save();
        ctx.beginPath();
        roofP.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
        });
        ctx.closePath();
        ctx.fillStyle = snapped.snappedEdge
          ? 'rgba(16, 185, 129, 0.36)'
          : isWing
          ? 'rgba(37, 99, 235, 0.36)'
          : 'rgba(255, 204, 0, 0.42)';
        ctx.fill();
        ctx.strokeStyle = snapped.snappedEdge ? '#10B981' : isWing ? '#2563EB' : '#FC3F1D';
        ctx.lineWidth = 2.4;
        ctx.stroke();

        const cp = proj(snapped.x, snapped.z, is3D ? h : 0);
        const info = snapped.snappedEdge
          ? `${snapped.width}×${snapped.depth} м · Стык без зазора`
          : isWing
          ? `Корпус: ${snapped.width}×${snapped.depth} м`
          : snapped.snapped
          ? `${snapped.width}×${snapped.depth} м · ${snapped.snappedStreetName}`
          : `${snapped.width}×${snapped.depth} м`;
        ctx.font = '700 11px Manrope, sans-serif';
        const tw = ctx.measureText(info).width + 12;
        ctx.fillStyle = 'rgba(24,24,27,0.9)';
        ctx.beginPath();
        ctx.roundRect(cp.sx - tw / 2, cp.sy - 28, tw, 20, 6);
        ctx.fill();
        ctx.fillStyle = snapped.snappedEdge ? '#6EE7B7' : isWing ? '#93C5FD' : '#FFCC00';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(info, cp.sx, cp.sy - 18);
        ctx.restore();
      } else if (drag.active && drag.mode === 'delete-building-area' && drag.moved) {
        const minX = Math.min(drag.startWorld.x, drag.currWorld.x);
        const maxX = Math.max(drag.startWorld.x, drag.currWorld.x);
        const minZ = Math.min(drag.startWorld.z, drag.currWorld.z);
        const maxZ = Math.max(drag.startWorld.z, drag.currWorld.z);
        const boxPts = [
          proj(minX, minZ, 0),
          proj(maxX, minZ, 0),
          proj(maxX, maxZ, 0),
          proj(minX, maxZ, 0),
        ];

        const hitBldgs = st.buildings.filter(
          (b) => b.x >= minX && b.x <= maxX && b.z >= minZ && b.z <= maxZ
        ).length;
        const hitStreets = st.streets.filter((s) =>
          rectIntersectsPolyline(s.points, minX, maxX, minZ, maxZ)
        ).length;
        const hitLands = st.landFeatures.filter((f) =>
          rectIntersectsPolyline(f.polygon, minX, maxX, minZ, maxZ)
        ).length;
        const hitPois = st.pois.filter(
          (p) => p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ
        ).length;

        ctx.save();
        ctx.beginPath();
        boxPts.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
        ctx.fill();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#DC2626';
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.setLineDash([]);

        const cp = proj((minX + maxX) * 0.5, (minZ + maxZ) * 0.5, 0);
        const parts: string[] = [];
        if (hitBldgs > 0) parts.push(`${hitBldgs} зд.`);
        if (hitStreets > 0) parts.push(`${hitStreets} дор.`);
        if (hitLands > 0) parts.push(`${hitLands} терр.`);
        if (hitPois > 0) parts.push(`${hitPois} мет.`);
        const msg = parts.length > 0 ? `Стереть: ${parts.join(', ')}` : 'Нет объектов в рамке';
        ctx.font = '700 11px Manrope, sans-serif';
        const tw = ctx.measureText(msg).width + 12;
        ctx.fillStyle = '#DC2626';
        ctx.beginPath();
        ctx.roundRect(cp.sx - tw / 2, cp.sy - 12, tw, 22, 6);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(msg, cp.sx, cp.sy - 1);
        ctx.restore();
      } else if (drag.active && drag.mode === 'marquee-select' && drag.moved) {
        const minX = Math.min(drag.startWorld.x, drag.currWorld.x);
        const maxX = Math.max(drag.startWorld.x, drag.currWorld.x);
        const minZ = Math.min(drag.startWorld.z, drag.currWorld.z);
        const maxZ = Math.max(drag.startWorld.z, drag.currWorld.z);
        const boxPts = [
          proj(minX, minZ, 0),
          proj(maxX, minZ, 0),
          proj(maxX, maxZ, 0),
          proj(minX, maxZ, 0),
        ];

        const hitBldgs = st.buildings.filter(
          (b) => b.x >= minX && b.x <= maxX && b.z >= minZ && b.z <= maxZ
        ).length;
        const hitStreets = st.streets.filter((s) =>
          rectIntersectsPolyline(s.points, minX, maxX, minZ, maxZ)
        ).length;
        const hitLands = st.landFeatures.filter((f) =>
          rectIntersectsPolyline(f.polygon, minX, maxX, minZ, maxZ)
        ).length;
        const hitPois = st.pois.filter(
          (p) => p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ
        ).length;
        const hitPlaces = renderedPlaceHitsRef.current.filter(
          (h) => h.place.x >= minX && h.place.x <= maxX && h.place.z >= minZ && h.place.z <= maxZ
        ).length;

        ctx.save();
        ctx.beginPath();
        boxPts.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(2, 132, 199, 0.16)';
        ctx.fill();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#0284C7';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.setLineDash([]);

        const cp = proj((minX + maxX) * 0.5, (minZ + maxZ) * 0.5, 0);
        const parts: string[] = [];
        if (hitBldgs > 0) parts.push(`${hitBldgs} зд.`);
        if (hitStreets > 0) parts.push(`${hitStreets} дор.`);
        if (hitLands > 0) parts.push(`${hitLands} терр.`);
        if (hitPois > 0) parts.push(`${hitPois} мет.`);
        if (hitPlaces > 0) parts.push(`${hitPlaces} подп.`);
        const msg = parts.length > 0 ? `Выделить: ${parts.join(', ')}` : 'Рамка мультивыделения';
        ctx.font = '700 11px Manrope, sans-serif';
        const tw = ctx.measureText(msg).width + 14;
        ctx.fillStyle = '#0284C7';
        ctx.beginPath();
        ctx.roundRect(cp.sx - tw / 2, cp.sy - 12, tw, 22, 6);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(msg, cp.sx, cp.sy - 1);
        ctx.restore();
      } else if (!st.photoMode && st.editorTool === 'add-building' && cursorWorldRef.current) {
        const cw = cursorWorldRef.current;
        const draftShape = st.draftBuildingSize.shape ?? 'rect';
        const fp =
          draftShape === 'triangle'
            ? createTriangleFootprint(
                cw.x,
                cw.z,
                st.draftBuildingSize.width,
                st.draftBuildingSize.depth,
                st.draftBuildingSize.angle,
                st.draftBuildingSize.triangleCorner ?? 0
              )
            : draftShape === 'circle'
            ? createCircleFootprint(
                cw.x,
                cw.z,
                st.draftBuildingSize.width,
                st.draftBuildingSize.depth,
                st.draftBuildingSize.angle
              )
            : draftShape === 'parallelogram'
            ? createParallelogramFootprint(
                cw.x,
                cw.z,
                st.draftBuildingSize.width,
                st.draftBuildingSize.depth,
                st.draftBuildingSize.angle,
                st.draftBuildingSize.skewDeg ?? 25
              )
            : createRectFootprint(
                cw.x,
                cw.z,
                st.draftBuildingSize.width,
                st.draftBuildingSize.depth,
                st.draftBuildingSize.angle
              );
        const h = Math.round(st.draftBuildingSize.floors * 4.2 + 3);
        const baseP = fp.map((pt) => proj(pt.x, pt.z, 0));
        const roofP = is3D ? fp.map((pt) => proj(pt.x, pt.z, h)) : baseP;

        ctx.beginPath();
        roofP.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 204, 0, 0.28)';
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#FC3F1D';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Live Road / Railway Drafting with Arbitrary-Angle Network Snapping & Shift+/-/Height Level HUD
      if (!st.photoMode && st.editorTool === 'add-street') {
        const currElevY = st.draftStreetElevationY ?? SERVER_GROUND_Y;
        const relElev = Math.round((currElevY - SERVER_GROUND_Y) * 10) / 10;
        const draftPts3D: WorldPoint3D[] =
          st.draftStreetPoints3D && st.draftStreetPoints3D.length === st.draftStreetPoints.length
            ? st.draftStreetPoints3D
            : st.draftStreetPoints.map((p) => ({ x: p.x, y: currElevY, z: p.z }));

        const cw = cursorWorldRef.current;
        const roadSnap = cw
          ? snapRoadPointToNetwork(cw, st.streets, currElevY, Math.max(12, 16 / Math.max(0.2, cam.zoom)))
          : null;

        if (draftPts3D.length > 0) {
          ctx.save();
          // Ground shadow preview for elevated draft segments
          if (useElevY && draftPts3D.some((p) => p.y > SERVER_GROUND_Y + 2)) {
            ctx.beginPath();
            draftPts3D.forEach((pt, idx) => {
              const gp = proj(pt.x, pt.z, 0);
              if (idx === 0) ctx.moveTo(gp.sx, gp.sy);
              else ctx.lineTo(gp.sx, gp.sy);
            });
            if (roadSnap) {
              const gp = proj(roadSnap.x, roadSnap.z, 0);
              ctx.lineTo(gp.sx, gp.sy);
            }
            ctx.strokeStyle = 'rgba(0,0,0,0.22)';
            ctx.lineWidth = 4;
            ctx.stroke();
          }

          ctx.beginPath();
          draftPts3D.forEach((pt, idx) => {
            const eOff = useElevY ? Math.max(-22, Math.min(82, pt.y - SERVER_GROUND_Y)) : 0;
            const p = proj(pt.x, pt.z, eOff);
            if (idx === 0) ctx.moveTo(p.sx, p.sy);
            else ctx.lineTo(p.sx, p.sy);
          });
          if (roadSnap) {
            const eOff = useElevY ? Math.max(-22, Math.min(82, currElevY - SERVER_GROUND_Y)) : 0;
            const cp = proj(roadSnap.x, roadSnap.z, eOff);
            ctx.lineTo(cp.sx, cp.sy);
          }
          ctx.strokeStyle =
            st.draftStreetRoadClass === 'railway'
              ? '#0EA5E9'
              : relElev < -0.5
              ? '#8B5CF6'
              : relElev > 0.5
              ? '#F59E0B'
              : '#FC3F1D';
          ctx.lineWidth = 4.2;
          ctx.setLineDash(relElev < -0.5 ? [5, 5] : [8, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          for (const pt of draftPts3D) {
            const eOff = useElevY ? Math.max(-22, Math.min(82, pt.y - SERVER_GROUND_Y)) : 0;
            const p = proj(pt.x, pt.z, eOff);
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, 5.2, 0, Math.PI * 2);
            ctx.fillStyle = '#FFCC00';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#18181B';
            ctx.stroke();
          }
          ctx.restore();
        }

        // Magnetic network snap ring & live elevation HUD near cursor
        if (roadSnap) {
          const eOff = useElevY ? Math.max(-22, Math.min(82, currElevY - SERVER_GROUND_Y)) : 0;
          const cp = proj(roadSnap.x, roadSnap.z, eOff);
          ctx.save();
          if (roadSnap.snapped) {
            ctx.beginPath();
            ctx.arc(cp.sx, cp.sy, 9.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
            ctx.fill();
            ctx.lineWidth = 2.4;
            ctx.strokeStyle = '#10B981';
            ctx.stroke();
          }
          const elevText =
            relElev > 0
              ? `Над землёй: +${relElev} м (Y=${currElevY})`
              : relElev < 0
              ? `Под землёй: ${relElev} м (Y=${currElevY})`
              : `Уровень земли (Y=${currElevY})`;
          const snapTag = roadSnap.snapped
            ? roadSnap.snapKind === 'vertex'
              ? ' · Узел перекрёстка'
              : ' · Привязка к трассе'
            : '';
          const hudText = `${elevText}${snapTag} · Shift +/−`;
          ctx.font = '700 11px Manrope, sans-serif';
          const tw = ctx.measureText(hudText).width + 14;
          const bx = Math.max(10, Math.min(width - tw - 10, cp.sx + 14));
          const by = Math.max(10, Math.min(height - 30, cp.sy - 28));
          ctx.fillStyle = 'rgba(24,24,27,0.92)';
          ctx.beginPath();
          ctx.roundRect(bx, by, tw, 22, 6);
          ctx.fill();
          ctx.fillStyle = roadSnap.snapped ? '#6EE7B7' : relElev > 0 ? '#FCD34D' : relElev < 0 ? '#C4B5FD' : '#FFFFFF';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(hudText, bx + 7, by + 11.5);
          ctx.restore();
        }
      }

      // Live POI Placement Preview under cursor
      if (!st.photoMode && st.editorTool === 'add-poi' && cursorWorldRef.current) {
        const cw = cursorWorldRef.current;
        const cp = proj(cw.x, cw.z, is3D ? 4 : 0);
        ctx.save();
        ctx.globalAlpha = 0.85;
        drawMapSymbolBadge(ctx, cp.sx, cp.sy - 8, st.draftPoiIcon ?? 'star', {
          radius: 10.5,
          isStandalone: true,
          isDark,
        });
        ctx.restore();
      }

      // Live City / District Label Placement Preview under cursor
      if (
        !st.photoMode &&
        st.editorTool === 'add-place' &&
        cursorWorldRef.current &&
        !hoveredPlaceIdRef.current
      ) {
        const cw = cursorWorldRef.current;
        const cp = proj(cw.x, cw.z, 0);
        const tierLabel =
          st.draftPlaceTier === 'city'
            ? 'Новый город'
            : st.draftPlaceTier === 'town'
            ? 'Новый посёлок'
            : st.draftPlaceTier === 'village'
            ? 'Новая деревня'
            : 'Новый район';
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(cp.sx, cp.sy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#FFCC00';
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = '#92400E';
        ctx.stroke();

        ctx.font = '700 11px Manrope, sans-serif';
        const tw = ctx.measureText(tierLabel).width + 14;
        ctx.beginPath();
        ctx.roundRect(cp.sx - tw / 2, cp.sy - 28, tw, 20, 6);
        ctx.fillStyle = isDark ? 'rgba(24,24,27,0.9)' : 'rgba(255,255,255,0.95)';
        ctx.fill();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = isDark ? '#FDE047' : '#92400E';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tierLabel, cp.sx, cp.sy - 18);
        ctx.restore();
      }

      if (!st.photoMode && st.editorTool === 'add-land') {
        const isWaterDraft = st.draftLandKind === 'water';
        const isSquareDraft = st.draftLandKind === 'square';
        const strokeColor = isWaterDraft ? '#2563EB' : isSquareDraft ? '#D97706' : '#16A34A';
        const fillColor = isWaterDraft
          ? 'rgba(59, 130, 246, 0.28)'
          : isSquareDraft
          ? 'rgba(217, 119, 6, 0.24)'
          : 'rgba(34, 197, 94, 0.28)';

        const cw = cursorWorldRef.current;
        const landSnapTol = Math.max(10, 15 / Math.max(0.15, cam.zoom));
        const landSnap =
          cw && st.snapToLand
            ? snapPointToLandFeatures(cw, st.landFeatures, landSnapTol)
            : cw
            ? { x: Math.round(cw.x), z: Math.round(cw.z), snapped: false, snapKind: 'none' as const }
            : null;

        ctx.save();

        // Highlight nearby existing territory nodes when node snapping is enabled
        if (cw && st.snapToLand) {
          const nearRadius = Math.max(85, 115 / Math.max(0.15, cam.zoom));
          const nearLands = st.landIndex.queryPoint(cw.x, cw.z, nearRadius, hitLandBuf.current);
          for (let ni = 0; ni < nearLands.length; ni++) {
            const nf = nearLands[ni].feature;
            const isTargetFeat = landSnap?.snapped && landSnap.targetLandId === nf.id;
            for (let vi = 0; vi < nf.polygon.length; vi++) {
              const v = nf.polygon[vi];
              if (Math.hypot(v.x - cw.x, v.z - cw.z) > nearRadius * 1.15) continue;
              const vp = proj(v.x, v.z);
              const isSnappedNode =
                isTargetFeat &&
                landSnap?.snapKind === 'vertex' &&
                Math.hypot(v.x - landSnap.x, v.z - landSnap.z) < 0.2;
              ctx.beginPath();
              ctx.arc(vp.sx, vp.sy, isSnappedNode ? 6.5 : 3.6, 0, Math.PI * 2);
              ctx.fillStyle = isSnappedNode ? '#10B981' : 'rgba(255, 255, 255, 0.85)';
              ctx.fill();
              ctx.lineWidth = isSnappedNode ? 2.2 : 1.5;
              ctx.strokeStyle = isSnappedNode ? '#FFFFFF' : '#10B981';
              ctx.stroke();
            }
          }
        }

        if (st.draftLandPoints.length > 0) {
          ctx.beginPath();
          st.draftLandPoints.forEach((pt, idx) => {
            const p = proj(pt.x, pt.z);
            if (idx === 0) ctx.moveTo(p.sx, p.sy);
            else ctx.lineTo(p.sx, p.sy);
          });
          if (landSnap) {
            const cp = proj(landSnap.x, landSnap.z);
            ctx.lineTo(cp.sx, cp.sy);
          }
          ctx.closePath();
          ctx.fillStyle = fillColor;
          ctx.fill();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          for (const pt of st.draftLandPoints) {
            const p = proj(pt.x, pt.z);
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = strokeColor;
            ctx.stroke();
          }
        }

        // Magnetic territory snap ring, edge guide & live HUD tag under cursor
        if (landSnap && landSnap.snapped) {
          if (landSnap.snapEdge) {
            const ea = proj(landSnap.snapEdge[0].x, landSnap.snapEdge[0].z);
            const eb = proj(landSnap.snapEdge[1].x, landSnap.snapEdge[1].z);
            ctx.beginPath();
            ctx.moveTo(ea.sx, ea.sy);
            ctx.lineTo(eb.sx, eb.sy);
            ctx.strokeStyle = '#10B981';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.stroke();
          }

          const cp = proj(landSnap.x, landSnap.z);
          ctx.beginPath();
          ctx.arc(cp.sx, cp.sy, 9.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.24)';
          ctx.fill();
          ctx.lineWidth = 2.4;
          ctx.strokeStyle = '#10B981';
          ctx.stroke();

          const sameType = landSnap.targetKind === st.draftLandKind;
          const snapLabel =
            landSnap.snapKind === 'vertex'
              ? sameType
                ? 'Узел территории · бесшовный стык'
                : 'Узел территории'
              : sameType
              ? 'Граница территории · бесшовный стык'
              : 'Граница территории';
          ctx.font = '700 11px Manrope, sans-serif';
          const tw = ctx.measureText(snapLabel).width + 14;
          const bx = Math.max(10, Math.min(width - tw - 10, cp.sx + 14));
          const by = Math.max(10, Math.min(height - 30, cp.sy - 28));
          ctx.fillStyle = 'rgba(24,24,27,0.92)';
          ctx.beginPath();
          ctx.roundRect(bx, by, tw, 22, 6);
          ctx.fill();
          ctx.fillStyle = '#6EE7B7';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(snapLabel, bx + 7, by + 11.5);
        }

        ctx.restore();
      }

      if (liveResizeBadgeRef.current) {
        const badge = liveResizeBadgeRef.current;
        ctx.font = '700 11px "JetBrains Mono", monospace';
        const tw = ctx.measureText(badge.text).width + 12;
        ctx.fillStyle = 'rgba(24,24,27,0.92)';
        ctx.beginPath();
        ctx.roundRect(badge.sx + 12, badge.sy - 26, tw, 22, 6);
        ctx.fill();
        ctx.fillStyle = '#FFCC00';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(badge.text, badge.sx + 18, badge.sy - 15);
      }

      elementAnimator.endFrame(now);
      ctx.restore();
    };

    let rafId: number | null = null;
    let tickTimeout: number | null = null;
    let disposed = false;

    const scheduleTick = () => {
      if (disposed) return;
      if (tickTimeout !== null) window.clearTimeout(tickTimeout);
      tickTimeout = window.setTimeout(() => {
        tickTimeout = null;
        if (
          !disposed &&
          !document.hidden &&
          !isInteractingRef.current &&
          (!stateRef.current.isEditorMode || stateRef.current.photoMode) &&
          stateRef.current.layers.mtrLines &&
          stateRef.current.layers.liveVehicles
        ) {
          scheduleDraw();
        } else {
          scheduleTick();
        }
      }, 1000);
    };

    const scheduleDraw = () => {
      if (disposed || rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (disposed) return;
        draw();
        if (
          (elementAnimatorRef.current.hasActiveAnimations ||
            landLabelCtrlRef.current.needsAnimationFrame) &&
          !document.hidden
        ) {
          scheduleDraw();
        } else {
          scheduleTick();
        }
      });
    };

    redrawRef.current = scheduleDraw;
    scheduleDraw();

    const ro = new ResizeObserver(() => scheduleDraw());
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (tickTimeout !== null) window.clearTimeout(tickTimeout);
      if (interactionTimerRef.current !== null) window.clearTimeout(interactionTimerRef.current);
      if (landLabelWakeTimerRef.current !== null) {
        window.clearTimeout(landLabelWakeTimerRef.current);
        landLabelWakeTimerRef.current = null;
      }
      cancelZoomAnims();
      redrawRef.current = null;
    };
  }, []);

  useEffect(() => {
    redrawRef.current?.();
  }, [
    camera,
    darkMode,
    mapStyle,
    layers,
    insolation,
    isEditorMode,
    photoMode,
    landFeatures,
    blueMapTiles,
    streets,
    buildings,
    stations,
    routes,
    pois,
    places,
    departuresMap,
    serverClockOffsetMs,
    activeRoute,
    pointA,
    pointB,
    selectedEntity,
    editorTool,
    snapToRoad,
    snapToBuilding,
    snapToLand,
    synthesisPolygon,
    isSynthesisPolygonClosed,
    isSelectingSynthesisArea,
    draftStreetPoints,
    draftStreetPoints3D,
    draftStreetElevationY,
    draftStreetRoadClass,
    draftLandPoints,
    draftLandKind,
    draftBuildingPolygon,
    draftBuildingSize,
    draftPoiIcon,
    draftPlaceTier,
    pickMode,
    activeWingId,
    isDrawingWing,
    mergeSourceBuildingId,
    multiSelectedBuildingIds,
    multiSelectedItems,
    multiSelectMode,
  ]);

  const queryLocalBuildings = (worldPt: WorldPoint, cam: CameraState) => {
    const r = Math.max(90, 85 / Math.max(0.08, cam.zoom));
    return stateRef.current.buildingIndices.buildingIndex.queryPoint(
      worldPt.x,
      worldPt.z,
      r,
      hitQueryBuf.current
    );
  };

  const hitTestRenderedPlace = (sx: number, sy: number): MapPlaceLabel | null => {
    const hits = renderedPlaceHitsRef.current;
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (sx >= h.x1 && sx <= h.x2 && sy >= h.y1 && sy <= h.y2) {
        return h.place;
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setContextMenu(null);
    cancelZoomAnims();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const st = stateRef.current;
    const cam = liveCameraRef.current;

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    // Multi-touch pinch-to-zoom + 2-finger rotate for mobile devices
    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      dragRef.current = {
        active: true,
        mode: 'pinch',
        startDist: Math.max(10, Math.hypot(dx, dy)),
        startAngle: Math.atan2(dy, dx),
        startMidX: (pts[0].x + pts[1].x) * 0.5,
        startMidY: (pts[0].y + pts[1].y) * 0.5,
        startCam: { ...cam },
        moved: true,
      };
      return;
    }

    const worldPt = screenToWorld(sx, sy, cam, rect.width, rect.height);
    const isShiftEditorAction =
      !st.photoMode &&
      e.button === 0 &&
      e.shiftKey &&
      st.isEditorMode &&
      (st.editorTool === 'synthesis' ||
        st.editorTool === 'select' ||
        st.selectedEntity?.type === 'building');
    const isOrbit = e.button === 2 || e.ctrlKey || (e.shiftKey && !isShiftEditorAction);

    if (!st.photoMode && !isOrbit && e.button === 0) {
      // 0a. True Multi-Selection Mode on Select tool (Shift + LMB click toggle OR Shift + Drag marquee box, or explicit multiSelectMode)
      const isMultiSelectPointer =
        st.isEditorMode &&
        st.editorTool === 'select' &&
        !st.mergeSourceBuildingId &&
        !st.isDrawingWing &&
        (e.shiftKey || Boolean(st.multiSelectMode));
      if (isMultiSelectPointer) {
        dragRef.current = {
          active: true,
          mode: 'marquee-select',
          startWorld: worldPt,
          currWorld: worldPt,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        return;
      }

      // 0. Drawing an extra architectural wing (корпус) onto selected building
      if (st.isDrawingWing && st.selectedEntity?.type === 'building') {
        if ((st.draftBuildingSize.shape ?? 'rect') === 'polygon') {
          const draftPts = st.draftBuildingPolygon ?? [];
          if (draftPts.length >= 3) {
            const h = Math.round(st.draftBuildingSize.floors * 4.2 + 3);
            const firstScreen = worldToScreen(
              draftPts[0].x,
              draftPts[0].z,
              st.layers.buildings3D && cam.pitch > 3 ? h : 0,
              cam,
              rect.width,
              rect.height
            );
            if (Math.hypot(firstScreen.sx - sx, firstScreen.sy - sy) <= 16) {
              callbacksRef.current.onFinishBuildingPolygon?.();
              return;
            }
          }
          const snapped = st.snapToBuilding
            ? snapPointToBuildings(
                worldPt,
                st.buildings,
                undefined,
                undefined,
                Math.max(6, 12 / Math.max(0.12, cam.zoom))
              )
            : { x: worldPt.x, z: worldPt.z };
          callbacksRef.current.onAddBuildingPolygonPoint?.({ x: snapped.x, z: snapped.z });
          return;
        }
        dragRef.current = {
          active: true,
          mode: 'draw-wing-area',
          targetBuildingId: st.selectedEntity.data.id,
          startWorld: worldPt,
          currWorld: worldPt,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        return;
      }

      // 1. Check direct interactive handles on selected object first
      if (
        !st.mergeSourceBuildingId &&
        (st.editorTool === 'select' || st.editorTool === 'move-transit')
      ) {
        const handles = getSelectedHandles(rect.width, rect.height);
        if (handles?.kind === 'building' && st.editorTool === 'select') {
          if (Math.hypot(handles.rotateHandle.sx - sx, handles.rotateHandle.sy - sy) <= 14) {
            callbacksRef.current.onBeginDragEdit?.();
            dragRef.current = {
              active: true,
              mode: 'rotate-building',
              building: handles.building,
              wingId: handles.wing.id,
              centerX: handles.wing.x,
              centerZ: handles.wing.z,
              moved: false,
            };
            return;
          }
          if (Math.hypot(handles.heightHandle.sx - sx, handles.heightHandle.sy - sy) <= 13) {
            callbacksRef.current.onBeginDragEdit?.();
            dragRef.current = {
              active: true,
              mode: 'resize-building-height',
              building: handles.building,
              wingId: handles.wing.id,
              startY: e.clientY,
              origHeight: handles.wing.height,
              moved: false,
            };
            return;
          }
          if (handles.isSculptMode) {
            for (const v of handles.vertices) {
              if (Math.hypot(v.sx - sx, v.sy - sy) <= 12) {
                if (e.altKey && handles.wing.footprint.length > 3) {
                  callbacksRef.current.onBeginDragEdit?.();
                  const nextB = removeBuildingWingVertex(handles.building, handles.wing.id, v.idx);
                  callbacksRef.current.onResizeBuilding(nextB);
                  callbacksRef.current.onEndDragEdit?.();
                  redrawRef.current?.();
                  return;
                }
                callbacksRef.current.onBeginDragEdit?.();
                dragRef.current = {
                  active: true,
                  mode: 'move-building-vertex',
                  building: handles.building,
                  wingId: handles.wing.id,
                  vertexIdx: v.idx,
                  moved: false,
                };
                return;
              }
            }
            for (const m of handles.midpoints) {
              if (Math.hypot(m.sx - sx, m.sy - sy) <= 11) {
                callbacksRef.current.onBeginDragEdit?.();
                const { building: inserted, insertedIdx } = insertBuildingWingVertex(
                  handles.building,
                  handles.wing.id,
                  m.afterIdx,
                  m.worldPt
                );
                callbacksRef.current.onResizeBuilding(inserted);
                dragRef.current = {
                  active: true,
                  mode: 'move-building-vertex',
                  building: inserted,
                  wingId: handles.wing.id,
                  vertexIdx: insertedIdx,
                  moved: true,
                };
                redrawRef.current?.();
                return;
              }
            }
          } else {
            for (const c of handles.corners) {
              if (Math.hypot(c.sx - sx, c.sy - sy) <= 12) {
                callbacksRef.current.onBeginDragEdit?.();
                dragRef.current = {
                  active: true,
                  mode: 'resize-building-corner',
                  building: handles.building,
                  wingId: handles.wing.id,
                  cornerIdx: c.idx,
                  moved: false,
                };
                return;
              }
            }
          }

          // Free building drag-moving when clicking directly on the selected building body in Editor mode
          if (st.isEditorMode && !e.shiftKey) {
            const hitSel = hitTestBuildingWithWing(
              sx,
              sy,
              [handles.building],
              cam,
              rect.width,
              rect.height,
              st.layers.elevation3D && cam.pitch > 0.5
            );
            if (hitSel) {
              dragRef.current = {
                active: true,
                mode: 'move-building',
                building: handles.building,
                wingId: e.altKey ? hitSel.wingId : undefined,
                clickedWingId: hitSel.wingId,
                startWorld: worldPt,
                startX: e.clientX,
                startY: e.clientY,
                moved: false,
              };
              return;
            }
          }
        } else if (handles?.kind === 'street' && st.editorTool === 'select') {
          if (Math.hypot(handles.widthHandle.sx - sx, handles.widthHandle.sy - sy) <= 13) {
            callbacksRef.current.onBeginDragEdit?.();
            dragRef.current = {
              active: true,
              mode: 'resize-street-width',
              street: handles.street,
              midPoint: handles.widthHandle.midPoint,
              moved: false,
            };
            return;
          }
          for (const v of handles.vertices) {
            if (Math.hypot(v.sx - sx, v.sy - sy) <= 12) {
              callbacksRef.current.onBeginDragEdit?.();
              dragRef.current = {
                active: true,
                mode: 'move-street-vertex',
                street: handles.street,
                vertexIdx: v.idx,
                moved: false,
              };
              return;
            }
          }
        } else if (handles?.kind === 'land' && st.editorTool === 'select') {
          for (const v of handles.vertices) {
            if (Math.hypot(v.sx - sx, v.sy - sy) <= 12) {
              callbacksRef.current.onBeginDragEdit?.();
              dragRef.current = {
                active: true,
                mode: 'move-land-vertex',
                feature: handles.feature,
                vertexIdx: v.idx,
                moved: false,
              };
              return;
            }
          }
        } else if (handles?.kind === 'route') {
          for (const v of handles.vertices) {
            if (Math.hypot(v.sx - sx, v.sy - sy) <= 12) {
              callbacksRef.current.onBeginDragEdit?.();
              dragRef.current = {
                active: true,
                mode: 'move-route-vertex',
                routeId: handles.route.id,
                points3D: handles.ctrlPts.map((pt) => ({ ...pt })),
                vertexIdx: v.idx,
                moved: false,
              };
              return;
            }
          }
          for (const m of handles.midpoints) {
            if (Math.hypot(m.sx - sx, m.sy - sy) <= 11) {
              callbacksRef.current.onBeginDragEdit?.();
              const inserted = [...handles.ctrlPts];
              inserted.splice(m.insertAfterIdx + 1, 0, { ...m.pt3D });
              callbacksRef.current.onUpdateRoutePath(
                handles.route.id,
                inserted.map((pt) => ({ x: pt.x, z: pt.z })),
                inserted
              );
              dragRef.current = {
                active: true,
                mode: 'move-route-vertex',
                routeId: handles.route.id,
                points3D: inserted,
                vertexIdx: m.insertAfterIdx + 1,
                moved: true,
              };
              return;
            }
          }
        }

        // Direct station, POI & city/district place drag in Editor mode (O(1) spatial query)
        if (st.isEditorMode) {
          // Check draggable city/district label when selected or at macro/city zoom
          if (
            st.editorTool === 'select' &&
            (st.selectedEntity?.type === 'place' || cam.zoom < 0.22)
          ) {
            const hitPlace = hitTestRenderedPlace(sx, sy);
            if (hitPlace) {
              callbacksRef.current.onBeginDragEdit?.();
              callbacksRef.current.onSelectEntity({ type: 'place', data: hitPlace });
              dragRef.current = {
                active: true,
                mode: 'move-place',
                place: hitPlace,
                startX: e.clientX,
                startY: e.clientY,
                moved: false,
              };
              return;
            }
          }

          // Check draggable POI pin first
          if (st.editorTool === 'select' && st.pois.length > 0) {
            for (let i = st.pois.length - 1; i >= 0; i--) {
              const poi = st.pois[i];
              const pElev =
                st.layers.elevation3D && st.layers.buildings3D && cam.pitch > 3 && typeof poi.y === 'number'
                  ? Math.max(-18, Math.min(72, poi.y - SERVER_GROUND_Y + 2))
                  : cam.pitch > 3
                  ? 4
                  : 0;
              const p = worldToScreen(poi.x, poi.z, pElev, cam, rect.width, rect.height);
              if (Math.hypot(p.sx - sx, (p.sy - 8) - sy) <= 15) {
                callbacksRef.current.onBeginDragEdit?.();
                callbacksRef.current.onSelectEntity({ type: 'poi', data: poi });
                dragRef.current = {
                  active: true,
                  mode: 'move-poi',
                  poi,
                  startX: e.clientX,
                  startY: e.clientY,
                  moved: false,
                };
                return;
              }
            }
          }

          const nearbyStations = st.stationIndices.stationIndex.queryPoint(
            worldPt.x,
            worldPt.z,
            Math.max(40, 26 / Math.max(0.08, cam.zoom)),
            hitStationBuf.current
          );
          for (let i = 0; i < nearbyStations.length; i++) {
            const station = nearbyStations[i];
            if (st.layers.metroOnly && !station.kinds.includes('metro')) continue;
            const canDrag =
              st.editorTool === 'move-transit' ||
              (st.selectedEntity?.type === 'station' && st.selectedEntity.data.id === station.id);
            if (!canDrag) continue;
            const elev =
              st.layers.elevation3D && st.layers.buildings3D && cam.pitch > 3
                ? Math.max(-18, Math.min(72, station.y - SERVER_GROUND_Y + 2))
                : cam.pitch > 3
                ? 2
                : 0;
            const p = worldToScreen(station.x, station.z, elev, cam, rect.width, rect.height);
            if (Math.hypot(p.sx - sx, p.sy - sy) <= 15) {
              callbacksRef.current.onBeginDragEdit?.();
              callbacksRef.current.onSelectEntity({ type: 'station', data: station });
              dragRef.current = {
                active: true,
                mode: 'move-station',
                station,
                startX: e.clientX,
                startY: e.clientY,
                moved: false,
              };
              return;
            }
          }
        }
      }

      // 1b. In 'add-place' tool, clicking an existing city/district label selects & lets you drag it immediately
      if (st.isEditorMode && st.editorTool === 'add-place') {
        const hitPlace = hitTestRenderedPlace(sx, sy);
        if (hitPlace) {
          callbacksRef.current.onBeginDragEdit?.();
          callbacksRef.current.onSelectEntity({ type: 'place', data: hitPlace });
          dragRef.current = {
            active: true,
            mode: 'move-place',
            place: hitPlace,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
          };
          return;
        }
      }

      // 2. Area-drag building creation OR freeform polygon vertex placement
      if (st.editorTool === 'add-building') {
        if ((st.draftBuildingSize.shape ?? 'rect') === 'polygon') {
          const draftPts = st.draftBuildingPolygon ?? [];
          if (draftPts.length >= 3) {
            const h = Math.round(st.draftBuildingSize.floors * 4.2 + 3);
            const firstScreen = worldToScreen(
              draftPts[0].x,
              draftPts[0].z,
              st.layers.buildings3D && cam.pitch > 3 ? h : 0,
              cam,
              rect.width,
              rect.height
            );
            if (Math.hypot(firstScreen.sx - sx, firstScreen.sy - sy) <= 16) {
              callbacksRef.current.onFinishBuildingPolygon?.();
              return;
            }
          }
          const snapped = st.snapToBuilding
            ? snapPointToBuildings(
                worldPt,
                st.buildings,
                undefined,
                undefined,
                Math.max(6, 12 / Math.max(0.12, cam.zoom))
              )
            : { x: worldPt.x, z: worldPt.z };
          callbacksRef.current.onAddBuildingPolygonPoint?.({ x: snapped.x, z: snapped.z });
          return;
        }
        dragRef.current = {
          active: true,
          mode: 'draw-building-area',
          startWorld: worldPt,
          currWorld: worldPt,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        return;
      }

      if (st.editorTool === 'delete-area') {
        dragRef.current = {
          active: true,
          mode: 'delete-building-area',
          startWorld: worldPt,
          currWorld: worldPt,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        return;
      }

      // 2b. Arbitrary Polygon Synthesis Zone drawing (Shift + ЛКМ or armed mode) & vertex dragging
      if (!st.photoMode && st.editorTool === 'synthesis') {
        if (st.synthesisPolygon.length > 0 && st.isSynthesisPolygonClosed && !e.shiftKey) {
          for (let idx = 0; idx < st.synthesisPolygon.length; idx++) {
            const pt = st.synthesisPolygon[idx];
            const sp = worldToScreen(pt.x, pt.z, 0, cam, rect.width, rect.height);
            if (Math.hypot(sp.sx - sx, sp.sy - sy) <= 14) {
              dragRef.current = {
                active: true,
                mode: 'move-synthesis-vertex',
                vertexIdx: idx,
                moved: false,
              };
              return;
            }
          }
        }
        if (st.isSelectingSynthesisArea || e.shiftKey) {
          if (!st.isSynthesisPolygonClosed && st.synthesisPolygon.length >= 3) {
            const firstPt = st.synthesisPolygon[0];
            const sp0 = worldToScreen(firstPt.x, firstPt.z, 0, cam, rect.width, rect.height);
            if (Math.hypot(sp0.sx - sx, sp0.sy - sy) <= 16) {
              callbacksRef.current.onFinishSynthesisPolygon?.();
              return;
            }
          }
          callbacksRef.current.onAddSynthesisVertex?.({
            x: Math.round(worldPt.x),
            z: Math.round(worldPt.z),
          });
          return;
        }
      }
    }

    // 3. Default map pan / orbit
    dragRef.current = {
      active: true,
      mode: isOrbit ? 'orbit' : 'pan',
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      startCam: { ...cam },
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const st = stateRef.current;
    const cam = liveCameraRef.current;

    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const drag = dragRef.current;

    // Mobile 2-finger pinch zoom & rotate
    if (drag.active && drag.mode === 'pinch' && activePointersRef.current.size >= 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.max(10, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      const midX = (pts[0].x + pts[1].x) * 0.5;
      const midY = (pts[0].y + pts[1].y) * 0.5;

      const scaleFactor = dist / drag.startDist;
      const nextZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, drag.startCam.zoom * scaleFactor));
      const deltaAngleDeg = ((angle - drag.startAngle) * 180) / Math.PI;
      const nextBearing = (drag.startCam.bearing - deltaAngleDeg + 360) % 360;

      const p0 = screenToWorld(
        drag.startMidX - rect.left,
        drag.startMidY - rect.top,
        drag.startCam,
        rect.width,
        rect.height
      );
      const tempCam: CameraState = {
        ...drag.startCam,
        zoom: nextZoom,
        bearing: nextBearing,
      };
      const p1 = screenToWorld(midX - rect.left, midY - rect.top, tempCam, rect.width, rect.height);
      pushLiveCamera({
        ...tempCam,
        x: drag.startCam.x - (p1.x - p0.x),
        z: drag.startCam.z - (p1.z - p0.z),
      });
      return;
    }

    const worldPt = screenToWorld(sx, sy, cam, rect.width, rect.height);
    cursorWorldRef.current = worldPt;
    callbacksRef.current.onCursorMove?.(worldPt);

    if (drag.active) {
      if (drag.mode === 'rotate-building') {
        drag.moved = true;
        const rawAngle =
          (Math.atan2(worldPt.z - drag.centerZ, worldPt.x - drag.centerX) * 180) / Math.PI + 90;
        const snappedAngle = e.shiftKey
          ? normalizeAngleDeg(Math.round(rawAngle / 15) * 15)
          : normalizeAngleDeg(Math.round(rawAngle));
        const rotated = rotateBuilding(drag.building, snappedAngle, drag.wingId);
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: `Поворот: ${Math.round(snappedAngle)}°`,
        };
        callbacksRef.current.onResizeBuilding(rotated);
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'move-building') {
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
          drag.moved = true;
          callbacksRef.current.onBeginDragEdit?.();
        }
        if (drag.moved) {
          const dx = worldPt.x - drag.startWorld.x;
          const dz = worldPt.z - drag.startWorld.z;
          const res = moveBuilding(drag.building, dx, dz, {
            wingId: drag.wingId,
            neighborBuildings: st.buildings,
            snapToBuilding: st.snapToBuilding,
            snapTolerance: Math.max(7, 10 / Math.max(0.15, cam.zoom)),
          });
          snapGuideRef.current = res.snapGuide ?? null;
          liveResizeBadgeRef.current = {
            sx,
            sy,
            text: `${drag.wingId ? 'Корпус' : 'Здание'}: ${Math.round(res.building.x)}, ${Math.round(res.building.z)}${res.snapped ? ' · Стык' : ''}`,
          };
          callbacksRef.current.onResizeBuilding(res.building);
          redrawRef.current?.();
        }
        return;
      }

      if (drag.mode === 'move-building-vertex') {
        drag.moved = true;
        const res = moveBuildingWingVertex(
          drag.building,
          drag.wingId,
          drag.vertexIdx,
          worldPt,
          st.buildings,
          st.snapToBuilding,
          Math.max(6, 10 / Math.max(0.15, cam.zoom))
        );
        snapGuideRef.current = res.snapGuide ?? null;
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: `Узел: ${Math.round(worldPt.x)}, ${Math.round(worldPt.z)}${res.snapped ? ' · Стык' : ''}`,
        };
        callbacksRef.current.onResizeBuilding(res.building);
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'resize-building-corner') {
        drag.moved = true;
        const resized = resizeBuildingWingCorner(
          drag.building,
          drag.wingId,
          drag.cornerIdx,
          worldPt,
          st.buildings,
          st.snapToBuilding ? 8 : 0
        );
        const wing =
          getBuildingWings(resized).find((w) => w.id === drag.wingId) ??
          getBuildingWings(resized)[0];
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: `${wing.measuredWidth ?? resized.measuredWidth}×${wing.measuredDepth ?? resized.measuredDepth} м`,
        };
        callbacksRef.current.onResizeBuilding(resized);
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'resize-building-height') {
        drag.moved = true;
        const dy = drag.startY - e.clientY;
        const nextHeight = Math.max(
          2,
          Math.round(drag.origHeight + dy / Math.max(0.25, cam.zoom * 0.7))
        );
        const updated = resizeBuildingWingHeight(drag.building, drag.wingId, nextHeight);
        const nextFloors = Math.max(1, Math.round(nextHeight / 3.8));
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: `Высота: ${nextHeight} м (${nextFloors} эт.)`,
        };
        callbacksRef.current.onResizeBuilding(updated);
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'move-street-vertex') {
        drag.moved = true;
        const rx = Math.round(worldPt.x);
        const rz = Math.round(worldPt.z);
        const nextPts = drag.street.points.map((pt, idx) =>
          idx === drag.vertexIdx ? { x: rx, z: rz } : pt
        );
        const nextPts3D = drag.street.points3D
          ? drag.street.points3D.map((pt, idx) =>
              idx === drag.vertexIdx ? { ...pt, x: rx, z: rz } : pt
            )
          : undefined;
        const updated: StreetSegment = {
          ...drag.street,
          points: nextPts,
          points3D: nextPts3D,
          isUserEdited: true,
        };
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: `X:${rx} Z:${rz}`,
        };
        callbacksRef.current.onResizeStreet(updated);
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'resize-street-width') {
        drag.moved = true;
        const dist = Math.hypot(worldPt.x - drag.midPoint.x, worldPt.z - drag.midPoint.z);
        const nextWidth = Math.max(6, Math.min(54, Math.round(dist * 2 - 8)));
        const updated: StreetSegment = {
          ...drag.street,
          width: nextWidth,
          isUserEdited: true,
        };
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: `Ширина: ${nextWidth} м`,
        };
        callbacksRef.current.onResizeStreet(updated);
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'move-land-vertex') {
        drag.moved = true;
        const landSnapTol = Math.max(10, 15 / Math.max(0.15, cam.zoom));
        const snappedLand = st.snapToLand
          ? snapPointToLandFeatures(worldPt, st.landFeatures, landSnapTol, drag.feature.id)
          : { x: Math.round(worldPt.x), z: Math.round(worldPt.z), snapped: false, snapKind: 'none' as const };
        snapGuideRef.current = snappedLand.snapEdge ?? null;
        const nextPoly = drag.feature.polygon.map((pt, idx) =>
          idx === drag.vertexIdx ? { x: snappedLand.x, z: snappedLand.z } : pt
        );
        const updated: LandFeature = {
          ...drag.feature,
          polygon: nextPoly,
          isUserEdited: true,
        };
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: snappedLand.snapped
            ? snappedLand.snapKind === 'vertex'
              ? `Стык с узлом · ${snappedLand.x}, ${snappedLand.z}`
              : `Стык с границей · ${snappedLand.x}, ${snappedLand.z}`
            : `Узел: ${snappedLand.x}, ${snappedLand.z}`,
        };
        callbacksRef.current.onResizeLandFeature(updated);
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'move-station') {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
          drag.moved = true;
        }
        if (drag.moved) {
          const nx = Math.round(worldPt.x);
          const nz = Math.round(worldPt.z);
          liveResizeBadgeRef.current = {
            sx,
            sy,
            text: `${drag.station.name}: ${nx}, ${nz}`,
          };
          callbacksRef.current.onMoveStation(drag.station.id, { x: nx, z: nz });
          redrawRef.current?.();
        }
        return;
      }

      if (drag.mode === 'move-poi') {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
          drag.moved = true;
        }
        if (drag.moved) {
          const nx = Math.round(worldPt.x);
          const nz = Math.round(worldPt.z);
          liveResizeBadgeRef.current = {
            sx,
            sy,
            text: `${drag.poi.name}: ${nx}, ${nz}`,
          };
          callbacksRef.current.onMovePoi?.(drag.poi.id, { x: nx, z: nz });
          redrawRef.current?.();
        }
        return;
      }

      if (drag.mode === 'move-place') {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
          drag.moved = true;
        }
        if (drag.moved) {
          const nx = Math.round(worldPt.x);
          const nz = Math.round(worldPt.z);
          liveResizeBadgeRef.current = {
            sx,
            sy,
            text: `${drag.place.name}: ${nx}, ${nz}`,
          };
          callbacksRef.current.onMovePlace?.(drag.place.id, { x: nx, z: nz });
          redrawRef.current?.();
        }
        return;
      }

      if (drag.mode === 'move-route-vertex') {
        drag.moved = true;
        const nx = Math.round(worldPt.x);
        const nz = Math.round(worldPt.z);
        const nextPts3D = drag.points3D.map((pt, idx) =>
          idx === drag.vertexIdx ? { ...pt, x: nx, z: nz } : pt
        );
        drag.points3D = nextPts3D;
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: `Узел линии: ${nx}, ${nz}`,
        };
        callbacksRef.current.onUpdateRoutePath(
          drag.routeId,
          nextPts3D.map((p) => ({ x: p.x, z: p.z })),
          nextPts3D
        );
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'move-synthesis-vertex') {
        drag.moved = true;
        const nx = Math.round(worldPt.x);
        const nz = Math.round(worldPt.z);
        liveResizeBadgeRef.current = {
          sx,
          sy,
          text: `Вершина #${drag.vertexIdx + 1}: ${nx}, ${nz}`,
        };
        callbacksRef.current.onMoveSynthesisVertex?.(drag.vertexIdx, { x: nx, z: nz });
        redrawRef.current?.();
        return;
      }

      if (
        drag.mode === 'draw-building-area' ||
        drag.mode === 'draw-wing-area' ||
        drag.mode === 'delete-building-area' ||
        drag.mode === 'marquee-select'
      ) {
        const distPx = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        const moveThreshold = drag.mode === 'marquee-select' ? 6 : 4;
        if (distPx > moveThreshold) drag.moved = true;
        drag.currWorld = worldPt;
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'pinch') return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 4) {
        drag.moved = true;
      }

      if (drag.mode === 'pan') {
        const startCam = drag.startCam;
        const p0 = screenToWorld(
          drag.startX - rect.left,
          drag.startY - rect.top,
          startCam,
          rect.width,
          rect.height
        );
        const p1 = screenToWorld(sx, sy, startCam, rect.width, rect.height);
        pushLiveCamera({
          ...startCam,
          x: startCam.x - (p1.x - p0.x),
          z: startCam.z - (p1.z - p0.z),
        });
      } else if (drag.mode === 'orbit') {
        const startCam = drag.startCam;
        pushLiveCamera({
          ...startCam,
          bearing: (startCam.bearing + dx * 0.35 + 360) % 360,
          pitch: Math.max(0, Math.min(58, startCam.pitch - dy * 0.25)),
        });
      }
      return;
    }

    // Hover detection using O(1) spatial queries (fast even with 10,000+ objects)
    let overHandle = false;
    if (
      !st.isDrawingWing &&
      !st.mergeSourceBuildingId &&
      (st.editorTool === 'select' || st.editorTool === 'move-transit')
    ) {
      const handles = getSelectedHandles(rect.width, rect.height);
      if (handles?.kind === 'building' && st.editorTool === 'select') {
        overHandle =
          Math.hypot(handles.rotateHandle.sx - sx, handles.rotateHandle.sy - sy) <= 14 ||
          Math.hypot(handles.heightHandle.sx - sx, handles.heightHandle.sy - sy) <= 13 ||
          (handles.isSculptMode
            ? handles.vertices.some((v) => Math.hypot(v.sx - sx, v.sy - sy) <= 12) ||
              handles.midpoints.some((m) => Math.hypot(m.sx - sx, m.sy - sy) <= 11)
            : handles.corners.some((c) => Math.hypot(c.sx - sx, c.sy - sy) <= 12));
      } else if (handles?.kind === 'street' && st.editorTool === 'select') {
        overHandle =
          Math.hypot(handles.widthHandle.sx - sx, handles.widthHandle.sy - sy) <= 13 ||
          handles.vertices.some((v) => Math.hypot(v.sx - sx, v.sy - sy) <= 12);
      } else if (handles?.kind === 'land' && st.editorTool === 'select') {
        overHandle = handles.vertices.some((v) => Math.hypot(v.sx - sx, v.sy - sy) <= 12);
      } else if (handles?.kind === 'route') {
        overHandle =
          handles.vertices.some((v) => Math.hypot(v.sx - sx, v.sy - sy) <= 12) ||
          handles.midpoints.some((m) => Math.hypot(m.sx - sx, m.sy - sy) <= 11);
      }
    }
    hoveredHandleRef.current = overHandle;

    const prevStation = hoveredStationIdRef.current;
    const prevPoi = hoveredPoiIdRef.current;
    const prevPlace = hoveredPlaceIdRef.current;
    const prevBuilding = hoveredBuildingIdRef.current;
    const prevStreet = hoveredStreetIdRef.current;
    const prevLand = hoveredLandIdRef.current;

    let hitPlace: string | null = null;
    if (
      !overHandle &&
      !st.mergeSourceBuildingId &&
      (st.editorTool === 'add-place' || st.selectedEntity?.type === 'place' || cam.zoom < 0.22)
    ) {
      const hp = hitTestRenderedPlace(sx, sy);
      if (hp) hitPlace = hp.id;
    }

    let hitPoi: string | null = null;
    if (!hitPlace && !overHandle && !st.mergeSourceBuildingId && st.pois.length > 0) {
      for (let i = st.pois.length - 1; i >= 0; i--) {
        const poi = st.pois[i];
        const pElev =
          st.layers.elevation3D && st.layers.buildings3D && cam.pitch > 3 && typeof poi.y === 'number'
            ? Math.max(-18, Math.min(72, poi.y - SERVER_GROUND_Y + 2))
            : cam.pitch > 3
            ? 4
            : 0;
        const p = worldToScreen(poi.x, poi.z, pElev, cam, rect.width, rect.height);
        if (Math.hypot(p.sx - sx, (p.sy - 8) - sy) <= 14) {
          hitPoi = poi.id;
          break;
        }
      }
    }
    hoveredPoiIdRef.current = hitPoi;

    let hitStation: string | null = null;
    if (!hitPlace && !hitPoi && st.editorTool !== 'delete-area' && !st.mergeSourceBuildingId) {
      const nearStations = st.stationIndices.stationIndex.queryPoint(
        worldPt.x,
        worldPt.z,
        Math.max(40, 24 / Math.max(0.08, cam.zoom)),
        hitStationBuf.current
      );
      for (let i = 0; i < nearStations.length; i++) {
        const station = nearStations[i];
        if (st.layers.metroOnly && !station.kinds.includes('metro')) continue;
        const elev =
          st.layers.elevation3D && st.layers.buildings3D && cam.pitch > 3
            ? Math.max(-18, Math.min(72, station.y - SERVER_GROUND_Y + 2))
            : cam.pitch > 3
            ? 2
            : 0;
        const p = worldToScreen(station.x, station.z, elev, cam, rect.width, rect.height);
        if (Math.hypot(p.sx - sx, p.sy - sy) <= 13) {
          hitStation = station.id;
          break;
        }
      }
    }
    hoveredStationIdRef.current = hitStation;

    let hitBId: string | null = null;
    let hitSId: string | null = null;
    let hitLId: string | null = null;

    if (!hitPlace && !hitPoi && !hitStation && !overHandle) {
      const localBldgs = queryLocalBuildings(worldPt, cam);
      const hitB = hitTestBuildingWithWing(
        sx,
        sy,
        localBldgs,
        cam,
        rect.width,
        rect.height,
        st.layers.elevation3D && cam.pitch > 0.5
      );
      if (hitB) {
        hitBId = hitB.building.id;
      } else if (st.editorTool === 'delete-area') {
        const tolBlocks = Math.max(12, 12 / Math.max(0.08, cam.zoom));
        const nearStreets = st.streetIndex.queryPoint(
          worldPt.x,
          worldPt.z,
          tolBlocks + 32,
          hitStreetBuf.current
        );
        const hitS = hitTestStreet(
          worldPt,
          nearStreets.map((x) => x.street),
          tolBlocks
        );
        if (hitS) {
          hitSId = hitS.id;
        } else {
          const nearLands = st.landIndex.queryPoint(worldPt.x, worldPt.z, 16, hitLandBuf.current);
          const hitL = nearLands.find((f) => pointInPolygon2D(worldPt, f.feature.polygon));
          if (hitL) hitLId = hitL.feature.id;
        }
      } else {
        const hp = hitTestRenderedPlace(sx, sy);
        if (hp) hitPlace = hp.id;
      }
    }

    hoveredPlaceIdRef.current = hitPlace;
    hoveredBuildingIdRef.current = hitBId;
    hoveredStreetIdRef.current = hitSId;
    hoveredLandIdRef.current = hitLId;

    if (
      prevStation !== hoveredStationIdRef.current ||
      prevPoi !== hoveredPoiIdRef.current ||
      prevPlace !== hoveredPlaceIdRef.current ||
      prevBuilding !== hoveredBuildingIdRef.current ||
      prevStreet !== hoveredStreetIdRef.current ||
      prevLand !== hoveredLandIdRef.current ||
      (st.editorTool !== 'select' && st.editorTool !== 'synthesis') ||
      st.isDrawingWing ||
      (st.isEditorMode &&
        st.editorTool === 'synthesis' &&
        !st.isSynthesisPolygonClosed &&
        st.synthesisPolygon.length > 0)
    ) {
      redrawRef.current?.();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (activePointersRef.current.size === 0) {
      dragRef.current = { active: false };
      liveResizeBadgeRef.current = null;
      isInteractingRef.current = false;
      redrawRef.current?.();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    const drag = dragRef.current;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    // If lifting one finger during a 2-finger pinch, settle cleanly without triggering a click
    if (drag.active && drag.mode === 'pinch') {
      if (activePointersRef.current.size < 2) {
        dragRef.current = { active: false };
        pushLiveCamera(liveCameraRef.current, true);
      }
      return;
    }

    dragRef.current = { active: false };
    liveResizeBadgeRef.current = null;
    snapGuideRef.current = null;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const st = stateRef.current;
    const cam = liveCameraRef.current;
    const worldPt = screenToWorld(sx, sy, cam, rect.width, rect.height);

    if (drag.active) {
      if (drag.mode === 'move-building') {
        if (drag.moved) {
          callbacksRef.current.onEndDragEdit?.();
        } else if (drag.clickedWingId) {
          callbacksRef.current.onSelectBuildingWithWing?.(drag.building, drag.clickedWingId);
        }
        redrawRef.current?.();
        return;
      }

      if (
        drag.mode === 'rotate-building' ||
        drag.mode === 'resize-building-corner' ||
        drag.mode === 'resize-building-height' ||
        drag.mode === 'move-building-vertex' ||
        drag.mode === 'move-street-vertex' ||
        drag.mode === 'resize-street-width' ||
        drag.mode === 'move-land-vertex' ||
        drag.mode === 'move-station' ||
        drag.mode === 'move-poi' ||
        drag.mode === 'move-place' ||
        drag.mode === 'move-route-vertex' ||
        drag.mode === 'move-synthesis-vertex'
      ) {
        if (drag.moved && drag.mode !== 'move-synthesis-vertex') {
          callbacksRef.current.onEndDragEdit?.();
        }
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'draw-wing-area') {
        if (drag.moved && drag.targetBuildingId) {
          const snapped = snapBuildingRectToStreet(
            drag.startWorld,
            drag.currWorld,
            st.streets,
            st.snapToRoad,
            90,
            st.buildings,
            undefined,
            st.snapToBuilding
          );
          callbacksRef.current.onAddWingFromArea?.(drag.targetBuildingId, snapped);
        }
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'draw-building-area') {
        if (drag.moved) {
          const snapped = snapBuildingRectToStreet(
            drag.startWorld,
            drag.currWorld,
            st.streets,
            st.snapToRoad,
            90,
            st.buildings,
            undefined,
            st.snapToBuilding
          );
          callbacksRef.current.onCreateBuildingFromArea(snapped);
        } else {
          callbacksRef.current.onMapClickForEditor(drag.startWorld);
        }
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'delete-building-area') {
        if (drag.moved) {
          const minX = Math.min(drag.startWorld.x, drag.currWorld.x);
          const maxX = Math.max(drag.startWorld.x, drag.currWorld.x);
          const minZ = Math.min(drag.startWorld.z, drag.currWorld.z);
          const maxZ = Math.max(drag.startWorld.z, drag.currWorld.z);
          callbacksRef.current.onDeleteObjectsInArea(minX, maxX, minZ, maxZ);
        } else {
          // Check POI single-click erase first
          let erasedPoi = false;
          for (let i = st.pois.length - 1; i >= 0; i--) {
            const poi = st.pois[i];
            const pElev =
              st.layers.elevation3D && st.layers.buildings3D && cam.pitch > 3 && typeof poi.y === 'number'
                ? Math.max(-18, Math.min(72, poi.y - SERVER_GROUND_Y + 2))
                : cam.pitch > 3
                ? 4
                : 0;
            const p = worldToScreen(poi.x, poi.z, pElev, cam, rect.width, rect.height);
            if (Math.hypot(p.sx - sx, (p.sy - 8) - sy) <= 15) {
              callbacksRef.current.onEraseSingleObject({ type: 'poi', id: poi.id });
              erasedPoi = true;
              break;
            }
          }
          if (!erasedPoi) {
            const localBldgs = queryLocalBuildings(worldPt, cam);
            const hitB = hitTestBuildingWithWing(
              sx,
              sy,
              localBldgs,
              cam,
              rect.width,
              rect.height,
              st.layers.elevation3D && cam.pitch > 0.5
            );
            if (hitB) {
              callbacksRef.current.onEraseSingleObject({ type: 'building', id: hitB.building.id });
            } else {
              const tolBlocks = Math.max(12, 12 / Math.max(0.08, cam.zoom));
              const nearStreets = st.streetIndex.queryPoint(
                worldPt.x,
                worldPt.z,
                tolBlocks + 32,
                hitStreetBuf.current
              );
              const hitS = hitTestStreet(
                worldPt,
                nearStreets.map((x) => x.street),
                tolBlocks
              );
              if (hitS) {
                callbacksRef.current.onEraseSingleObject({ type: 'street', id: hitS.id });
              } else {
                const nearLands = st.landIndex.queryPoint(
                  worldPt.x,
                  worldPt.z,
                  16,
                  hitLandBuf.current
                );
                const hitL = nearLands.find((f) => pointInPolygon2D(worldPt, f.feature.polygon));
                if (hitL) {
                  callbacksRef.current.onEraseSingleObject({ type: 'land', id: hitL.feature.id });
                }
              }
            }
          }
        }
        redrawRef.current?.();
        return;
      }

      if (drag.mode === 'marquee-select') {
        if (drag.moved) {
          // Box multi-selection: add all buildings, streets, land polygons, POIs, and visible places inside the rectangle
          const minX = Math.min(drag.startWorld.x, drag.currWorld.x);
          const maxX = Math.max(drag.startWorld.x, drag.currWorld.x);
          const minZ = Math.min(drag.startWorld.z, drag.currWorld.z);
          const maxZ = Math.max(drag.startWorld.z, drag.currWorld.z);
          const collected: MultiSelectedItem[] = [];
          for (let i = 0; i < st.buildings.length; i++) {
            const b = st.buildings[i];
            if (b.x >= minX && b.x <= maxX && b.z >= minZ && b.z <= maxZ) {
              collected.push({ type: 'building', id: b.id });
            }
          }
          for (let i = 0; i < st.streets.length; i++) {
            const s = st.streets[i];
            if (rectIntersectsPolyline(s.points, minX, maxX, minZ, maxZ)) {
              collected.push({ type: 'street', id: s.id });
            }
          }
          for (let i = 0; i < st.landFeatures.length; i++) {
            const f = st.landFeatures[i];
            if (rectIntersectsPolyline(f.polygon, minX, maxX, minZ, maxZ)) {
              collected.push({ type: 'land', id: f.id });
            }
          }
          for (let i = 0; i < st.pois.length; i++) {
            const p = st.pois[i];
            if (p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ) {
              collected.push({ type: 'poi', id: p.id });
            }
          }
          const seenPlaces = new Set<string>();
          for (let i = 0; i < renderedPlaceHitsRef.current.length; i++) {
            const pl = renderedPlaceHitsRef.current[i].place;
            if (
              !seenPlaces.has(pl.id) &&
              pl.x >= minX &&
              pl.x <= maxX &&
              pl.z >= minZ &&
              pl.z <= maxZ
            ) {
              seenPlaces.add(pl.id);
              collected.push({ type: 'place', id: pl.id });
            }
          }
          if (collected.length > 0) {
            callbacksRef.current.onAddMultiSelectEntities?.(collected);
          }
        } else if (callbacksRef.current.onToggleMultiSelectEntity) {
          // Single Shift+LMB click toggle across ALL editable object types (POIs, Places, Buildings, Streets, Land)
          let matched = false;

          // 1. Standalone POIs
          if (st.pois.length > 0) {
            for (let i = st.pois.length - 1; i >= 0; i--) {
              const poi = st.pois[i];
              const pElev =
                st.layers.elevation3D &&
                st.layers.buildings3D &&
                cam.pitch > 3 &&
                typeof poi.y === 'number'
                  ? Math.max(-18, Math.min(72, poi.y - SERVER_GROUND_Y + 2))
                  : cam.pitch > 3
                  ? 4
                  : 0;
              const p = worldToScreen(poi.x, poi.z, pElev, cam, rect.width, rect.height);
              if (Math.hypot(p.sx - sx, p.sy - 8 - sy) <= 15) {
                callbacksRef.current.onToggleMultiSelectEntity({ type: 'poi', id: poi.id });
                matched = true;
                break;
              }
            }
          }

          // 2. Rendered Place Labels when macro zoom or already selecting places
          const hasMultiPlace = st.multiSelectedItems.some((it) => it.type === 'place');
          if (!matched && (cam.zoom < 0.24 || hasMultiPlace || st.selectedEntity?.type === 'place')) {
            const hitPlace = hitTestRenderedPlace(sx, sy);
            if (hitPlace) {
              callbacksRef.current.onToggleMultiSelectEntity({ type: 'place', id: hitPlace.id });
              matched = true;
            }
          }

          // 3. Buildings
          if (!matched) {
            const localBldgs = queryLocalBuildings(worldPt, cam);
            const hitB = hitTestBuildingWithWing(
              sx,
              sy,
              localBldgs,
              cam,
              rect.width,
              rect.height,
              st.layers.elevation3D && cam.pitch > 0.5
            );
            if (hitB) {
              callbacksRef.current.onToggleMultiSelectEntity({
                type: 'building',
                id: hitB.building.id,
              });
              matched = true;
            }
          }

          // 4. Streets & Railways
          if (!matched) {
            const tolBlocks = Math.max(12, 13 / Math.max(0.08, cam.zoom));
            const nearStreets = st.streetIndex.queryPoint(
              worldPt.x,
              worldPt.z,
              tolBlocks + 30,
              hitStreetBuf.current
            );
            const hitSt = hitTestStreet(
              worldPt,
              nearStreets.map((x) => x.street),
              tolBlocks
            );
            if (hitSt) {
              callbacksRef.current.onToggleMultiSelectEntity({ type: 'street', id: hitSt.id });
              matched = true;
            }
          }

          // 5. Rendered Place Labels (at city/quarter zoom if clicked directly on label)
          if (!matched) {
            const hitPlace = hitTestRenderedPlace(sx, sy);
            if (hitPlace) {
              callbacksRef.current.onToggleMultiSelectEntity({ type: 'place', id: hitPlace.id });
              matched = true;
            }
          }

          // 6. Land Features (parks, water, squares — smallest containing polygon wins)
          if (!matched) {
            const nearLands = st.landIndex.queryPoint(worldPt.x, worldPt.z, 20, hitLandBuf.current);
            let bestLandId: string | null = null;
            let bestArea = Infinity;
            for (let i = 0; i < nearLands.length; i++) {
              const lf = nearLands[i];
              if (pointInPolygon2D(worldPt, lf.feature.polygon)) {
                const area =
                  (lf.aabb.maxX - lf.aabb.minX) * (lf.aabb.maxZ - lf.aabb.minZ);
                if (area < bestArea) {
                  bestArea = area;
                  bestLandId = lf.feature.id;
                }
              }
            }
            if (bestLandId) {
              callbacksRef.current.onToggleMultiSelectEntity({ type: 'land', id: bestLandId });
            }
          }
        }
        redrawRef.current?.();
        return;
      }

      if (drag.moved || drag.mode === 'orbit' || e.button !== 0) {
        if (drag.moved) {
          pushLiveCamera(liveCameraRef.current, true);
        }
        return;
      }
    } else if (e.button !== 0) {
      return;
    }

    if (st.photoMode) {
      return;
    }

    // 0. Merge Building target pick mode
    if (st.mergeSourceBuildingId) {
      const localBldgs = queryLocalBuildings(worldPt, cam);
      const hitB = hitTestBuildingWithWing(
        sx,
        sy,
        localBldgs,
        cam,
        rect.width,
        rect.height,
        st.layers.elevation3D && cam.pitch > 0.5
      );
      if (hitB && hitB.building.id !== st.mergeSourceBuildingId) {
        callbacksRef.current.onCompleteMergeBuilding?.(hitB.building.id);
      }
      return;
    }

    // 0b. Universal Multi-Selection on Shift + LMB in Editor Select tool (POIs, Buildings, Streets, Land)
    if (st.isEditorMode && st.editorTool !== 'synthesis' && e.shiftKey) {
      // 1. Standalone POIs
      if (st.pois.length > 0 && callbacksRef.current.onToggleMultiSelectEntity) {
        for (let i = st.pois.length - 1; i >= 0; i--) {
          const poi = st.pois[i];
          const pElev =
            st.layers.elevation3D && st.layers.buildings3D && cam.pitch > 3 && typeof poi.y === 'number'
              ? Math.max(-18, Math.min(72, poi.y - SERVER_GROUND_Y + 2))
              : cam.pitch > 3
              ? 4
              : 0;
          const p = worldToScreen(poi.x, poi.z, pElev, cam, rect.width, rect.height);
          if (Math.hypot(p.sx - sx, (p.sy - 8) - sy) <= 15) {
            callbacksRef.current.onToggleMultiSelectEntity({ type: 'poi', id: poi.id });
            return;
          }
        }
      }

      // 2. Buildings
      const localBldgs = queryLocalBuildings(worldPt, cam);
      const hitB = hitTestBuildingWithWing(
        sx,
        sy,
        localBldgs,
        cam,
        rect.width,
        rect.height,
        st.layers.elevation3D && cam.pitch > 0.5
      );
      if (hitB) {
        if (callbacksRef.current.onToggleMultiSelectEntity) {
          callbacksRef.current.onToggleMultiSelectEntity({ type: 'building', id: hitB.building.id });
        } else if (callbacksRef.current.onToggleMultiSelectBuilding) {
          callbacksRef.current.onToggleMultiSelectBuilding(hitB.building.id);
        } else if (
          st.selectedEntity?.type === 'building' &&
          hitB.building.id !== st.selectedEntity.data.id
        ) {
          callbacksRef.current.onQuickMergeBuildings?.(
            st.selectedEntity.data.id,
            hitB.building.id
          );
        }
        return;
      }

      // 3. Streets & Railways
      if (callbacksRef.current.onToggleMultiSelectEntity) {
        const tolBlocks = Math.max(12, 13 / Math.max(0.08, cam.zoom));
        const nearStreets = st.streetIndex.queryPoint(
          worldPt.x,
          worldPt.z,
          tolBlocks + 30,
          hitStreetBuf.current
        );
        const hitSt = hitTestStreet(
          worldPt,
          nearStreets.map((x) => x.street),
          tolBlocks
        );
        if (hitSt) {
          callbacksRef.current.onToggleMultiSelectEntity({ type: 'street', id: hitSt.id });
          return;
        }

        // 4. Land Features (parks, water, squares)
        const nearLands = st.landIndex.queryPoint(worldPt.x, worldPt.z, 20, hitLandBuf.current);
        for (let i = 0; i < nearLands.length; i++) {
          if (pointInPolygon2D(worldPt, nearLands[i].feature.polygon)) {
            callbacksRef.current.onToggleMultiSelectEntity({
              type: 'land',
              id: nearLands[i].feature.id,
            });
            return;
          }
        }
      }
    }

    // 1. Route point picking mode
    if (st.pickMode) {
      callbacksRef.current.onPickRoutePoint(st.pickMode, worldPt);
      return;
    }

    // 2. Editor creation modes
    if (st.editorTool === 'add-street') {
      const currElevY = st.draftStreetElevationY ?? SERVER_GROUND_Y;
      const snapped = snapRoadPointToNetwork(
        worldPt,
        st.streets,
        currElevY,
        Math.max(12, 16 / Math.max(0.2, cam.zoom))
      );
      callbacksRef.current.onMapClickForEditor({
        x: snapped.x,
        z: snapped.z,
        y: currElevY,
      });
      return;
    }

    if (st.editorTool === 'add-land') {
      const landSnapTol = Math.max(10, 15 / Math.max(0.15, cam.zoom));
      const snappedLand = st.snapToLand
        ? snapPointToLandFeatures(worldPt, st.landFeatures, landSnapTol)
        : { x: Math.round(worldPt.x), z: Math.round(worldPt.z) };
      callbacksRef.current.onMapClickForEditor({ x: snappedLand.x, z: snappedLand.z });
      return;
    }

    if (
      st.editorTool === 'add-building' ||
      st.editorTool === 'add-poi' ||
      st.editorTool === 'add-place'
    ) {
      callbacksRef.current.onMapClickForEditor(worldPt);
      return;
    }

    // 2a. City / District Place label hit-test at regional/metropolitan zoom
    if (cam.zoom < 0.22) {
      const hitPlace = hitTestRenderedPlace(sx, sy);
      if (hitPlace) {
        callbacksRef.current.onSelectEntity({ type: 'place', data: hitPlace });
        return;
      }
    }

    // 2b. Standalone Map POI hit-test
    if (st.pois.length > 0) {
      for (let i = st.pois.length - 1; i >= 0; i--) {
        const poi = st.pois[i];
        const pElev =
          st.layers.elevation3D && st.layers.buildings3D && cam.pitch > 3 && typeof poi.y === 'number'
            ? Math.max(-18, Math.min(72, poi.y - SERVER_GROUND_Y + 2))
            : cam.pitch > 3
            ? 4
            : 0;
        const p = worldToScreen(poi.x, poi.z, pElev, cam, rect.width, rect.height);
        if (Math.hypot(p.sx - sx, (p.sy - 8) - sy) <= 15) {
          callbacksRef.current.onSelectEntity({ type: 'poi', data: poi });
          return;
        }
      }
    }

    // 3. Station hit-test (spatially indexed)
    const nearStations = st.stationIndices.stationIndex.queryPoint(
      worldPt.x,
      worldPt.z,
      Math.max(44, 28 / Math.max(0.08, cam.zoom)),
      hitStationBuf.current
    );
    nearStations.sort(
      (a, b) => (b.kinds.includes('metro') ? 1 : 0) - (a.kinds.includes('metro') ? 1 : 0)
    );
    for (let i = 0; i < nearStations.length; i++) {
      const station = nearStations[i];
      if (st.layers.metroOnly && !station.kinds.includes('metro')) continue;
      const elev =
        st.layers.elevation3D && st.layers.buildings3D && cam.pitch > 3
          ? Math.max(-18, Math.min(72, station.y - SERVER_GROUND_Y + 2))
          : cam.pitch > 3
          ? 2
          : 0;
      const p = worldToScreen(station.x, station.z, elev, cam, rect.width, rect.height);
      if (Math.hypot(p.sx - sx, p.sy - sy) <= 14) {
        callbacksRef.current.onSelectEntity({ type: 'station', data: station });
        return;
      }
    }

    // 3b. In 'move-transit' tool, prioritize transit line selection right after stations
    if (st.isEditorMode && st.editorTool === 'move-transit') {
      const tolBlocks = Math.max(14, 14 / Math.max(0.08, cam.zoom));
      const nearRoutes = st.routeIndices.routeIndex.queryPoint(
        worldPt.x,
        worldPt.z,
        tolBlocks + 32,
        hitRouteBuf.current
      );
      const hitR = hitTestIndexedRoutes(worldPt, nearRoutes, tolBlocks, st.layers.metroOnly);
      if (hitR) {
        callbacksRef.current.onSelectEntity({ type: 'route', data: hitR });
        return;
      }
    }

    // 4. 3D Building & Wing hit-test (spatially indexed)
    const localBldgs = queryLocalBuildings(worldPt, cam);
    const hitB = hitTestBuildingWithWing(
      sx,
      sy,
      localBldgs,
      cam,
      rect.width,
      rect.height,
      st.layers.elevation3D && cam.pitch > 0.5
    );
    if (hitB) {
      if (callbacksRef.current.onSelectBuildingWithWing) {
        callbacksRef.current.onSelectBuildingWithWing(hitB.building, hitB.wingId);
      } else {
        callbacksRef.current.onSelectEntity({ type: 'building', data: hitB.building });
      }
      return;
    }

    // 5. Street hit-test (spatially indexed)
    const tolBlocks = Math.max(12, 10 / Math.max(0.08, cam.zoom));
    const nearStreets = st.streetIndex.queryPoint(
      worldPt.x,
      worldPt.z,
      tolBlocks + 36,
      hitStreetBuf.current
    );
    const hitS = hitTestStreet(
      worldPt,
      nearStreets.map((x) => x.street),
      tolBlocks
    );
    if (hitS) {
      callbacksRef.current.onSelectEntity({ type: 'street', data: hitS });
      return;
    }

    // 5b. Transit line hit-test
    if (st.isEditorMode && st.layers.mtrLines) {
      const rTol = Math.max(12, 12 / Math.max(0.08, cam.zoom));
      const nearRoutes = st.routeIndices.routeIndex.queryPoint(
        worldPt.x,
        worldPt.z,
        rTol + 32,
        hitRouteBuf.current
      );
      const hitR = hitTestIndexedRoutes(worldPt, nearRoutes, rTol, st.layers.metroOnly);
      if (hitR) {
        callbacksRef.current.onSelectEntity({ type: 'route', data: hitR });
        return;
      }
    }

    // 5c. Land polygon hit-test
    const nearLands = st.landIndex.queryPoint(worldPt.x, worldPt.z, 16, hitLandBuf.current);
    const hitL = nearLands.find((f) => pointInPolygon2D(worldPt, f.feature.polygon));
    if (hitL) {
      callbacksRef.current.onSelectEntity({ type: 'land', data: hitL.feature });
      return;
    }

    // 5d. City / District Place label fallback hit-test at city/quarter zoom
    const hitPlaceFallback = hitTestRenderedPlace(sx, sy);
    if (hitPlaceFallback) {
      callbacksRef.current.onSelectEntity({ type: 'place', data: hitPlaceFallback });
      return;
    }

    // 6. Plain map point
    callbacksRef.current.onSelectEntity({
      type: 'point',
      x: Math.round(worldPt.x),
      z: Math.round(worldPt.z),
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Cancel any external flyTo / button camera transition so wheel zoom responds immediately
    if (camAnimRef.current.rafId !== null) {
      window.cancelAnimationFrame(camAnimRef.current.rafId);
      camAnimRef.current.rafId = null;
    }

    const clampedDelta = Math.max(-160, Math.min(160, e.deltaY));
    const stepFactor = Math.exp(-clampedDelta * 0.00185);
    const curCam = liveCameraRef.current;
    const baseZoom = wheelAnimRef.current ? wheelAnimRef.current.targetZoom : curCam.zoom;
    const nextTargetZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, baseZoom * stepFactor));
    const anchorWorld = screenToWorld(sx, sy, curCam, rect.width, rect.height);

    if (wheelAnimRef.current) {
      wheelAnimRef.current.targetZoom = nextTargetZoom;
      wheelAnimRef.current.anchorSx = sx;
      wheelAnimRef.current.anchorSy = sy;
      wheelAnimRef.current.anchorWorldX = anchorWorld.x;
      wheelAnimRef.current.anchorWorldZ = anchorWorld.z;
      return;
    }

    const animState = {
      rafId: null as number | null,
      targetZoom: nextTargetZoom,
      anchorSx: sx,
      anchorSy: sy,
      anchorWorldX: anchorWorld.x,
      anchorWorldZ: anchorWorld.z,
      lastTs: performance.now(),
    };
    wheelAnimRef.current = animState;

    const stepWheel = (now: number) => {
      const anim = wheelAnimRef.current;
      const cv = canvasRef.current;
      if (!anim || !cv) {
        wheelAnimRef.current = null;
        return;
      }
      const r = cv.getBoundingClientRect();
      const dt = Math.min(0.05, Math.max(0.001, (now - anim.lastTs) / 1000));
      anim.lastTs = now;

      const c = liveCameraRef.current;
      const curLog = Math.log(Math.max(MIN_MAP_ZOOM, c.zoom));
      const tgtLog = Math.log(Math.max(MIN_MAP_ZOOM, anim.targetZoom));
      const diff = tgtLog - curLog;

      if (Math.abs(diff) < 0.0016) {
        const tempCam: CameraState = { ...c, zoom: anim.targetZoom };
        const after = screenToWorld(anim.anchorSx, anim.anchorSy, tempCam, r.width, r.height);
        const settledCam: CameraState = {
          ...tempCam,
          x: c.x + (anim.anchorWorldX - after.x),
          z: c.z + (anim.anchorWorldZ - after.z),
        };
        liveCameraRef.current = settledCam;
        wheelAnimRef.current = null;
        lastPushedCamRef.current = settledCam;
        callbacksRef.current.onCameraChange(settledCam);
        redrawRef.current?.();
        return;
      }

      const k = 1 - Math.exp(-dt * 15);
      const nextZoom = Math.exp(curLog + diff * k);
      const tempCam: CameraState = { ...c, zoom: nextZoom };
      const after = screenToWorld(anim.anchorSx, anim.anchorSy, tempCam, r.width, r.height);
      const nextCam: CameraState = {
        ...tempCam,
        x: c.x + (anim.anchorWorldX - after.x),
        z: c.z + (anim.anchorWorldZ - after.z),
      };
      liveCameraRef.current = nextCam;
      redrawRef.current?.();

      if (now - lastCamSyncMsRef.current >= 140) {
        lastCamSyncMsRef.current = now;
        lastPushedCamRef.current = nextCam;
        callbacksRef.current.onCameraChange(nextCam);
      }

      anim.rafId = window.requestAnimationFrame(stepWheel);
    };

    animState.rafId = window.requestAnimationFrame(stepWheel);
  };

  const handleDoubleClick = () => {
    const st = stateRef.current;
    if (
      !st.photoMode &&
      st.isEditorMode &&
      st.editorTool === 'synthesis' &&
      !st.isSynthesisPolygonClosed &&
      st.synthesisPolygon.length >= 3
    ) {
      callbacksRef.current.onFinishSynthesisPolygon?.();
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (stateRef.current.photoMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy, liveCameraRef.current, rect.width, rect.height);
    setContextMenu({
      screenX: Math.min(rect.width - 210, Math.max(12, sx)),
      screenY: Math.min(rect.height - 150, Math.max(12, sy)),
      world: { x: Math.round(world.x), z: Math.round(world.z) },
    });
  };

  const cursorClass = photoMode
    ? 'cursor-grab active:cursor-grabbing'
    : pickMode ||
      isDrawingWing ||
      mergeSourceBuildingId ||
      isSelectingSynthesisArea ||
      (editorTool !== 'select' && editorTool !== 'move-transit' && editorTool !== 'synthesis')
    ? 'cursor-crosshair'
    : editorTool === 'move-transit'
    ? 'cursor-move'
    : 'cursor-grab active:cursor-grabbing';

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        data-testid="murs-map-canvas"
        data-style={mapStyle}
        data-pitch={Math.round(camera.pitch)}
        data-zoom={camera.zoom.toFixed(2)}
        data-relief={layers.terrainRelief ? 'on' : 'off'}
        data-editor={isEditorMode ? 'on' : 'off'}
        data-photo={photoMode ? 'on' : 'off'}
        data-buildings={buildings.length}
        data-streets={streets.length}
        data-tiles={blueMapTiles.length}
        className={`block w-full h-full touch-none ${cursorClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />

      {contextMenu && !photoMode && (
        <div
          role="menu"
          className="absolute z-30 w-52 rounded-xl bg-white dark:bg-[#23262E] border border-neutral-200 dark:border-neutral-700 shadow-lg py-1.5 text-sm origin-top-left murs-anim-pop"
          style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
        >
          <div className="px-3 py-1 text-xs font-mono tabular-nums text-neutral-500 dark:text-neutral-400 border-b border-neutral-100 dark:border-neutral-700/70">
            X: {contextMenu.world.x} · Z: {contextMenu.world.z}
          </div>
          <button
            type="button"
            onClick={() => {
              onSetRoutePointFromContext('A', contextMenu.world);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 text-neutral-800 dark:text-neutral-100 transition-colors"
          >
            Маршрут отсюда (точка А)
          </button>
          <button
            type="button"
            onClick={() => {
              onSetRoutePointFromContext('B', contextMenu.world);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 text-neutral-800 dark:text-neutral-100 transition-colors"
          >
            Маршрут сюда (точка Б)
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenBlueMapAt(contextMenu.world);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 text-neutral-800 dark:text-neutral-100 transition-colors border-t border-neutral-100 dark:border-neutral-700/70"
          >
            Открыть на спутнике
          </button>
        </div>
      )}
    </div>
  );
};

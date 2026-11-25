import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Building2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  Eraser,
  Layers2,
  MapPin,
  Merge,
  Minus,
  Mountain,
  MousePointerClick,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Route as RouteIcon,
  Save,
  Scissors,
  TrainFront,
  Trash2,
  Trees,
  Type,
  Undo2,
  Upload,
  Waves,
  X,
} from 'lucide-react';
import type {
  Building3D,
  BuildingCategory,
  EditorTool,
  LandFeature,
  MapPlaceLabel,
  MapPoi,
  MapStyleMode,
  MtrRoute,
  MultiSelectKind,
  MultiSelectedItem,
  OneWayDirection,
  PoiIconKind,
  RoadClass,
  RoofType,
  SelectedEntity,
  SettlementTier,
  StreetSegment,
  WorldPoint,
  WorldPoint3D,
} from '../types/map';
import { MuromorskMetroBadge } from './MuromorskMetroBadge';
import { isMuromorskMetroRoute } from '../utils/mursTransitBrand';
import {
  createCircleFootprint,
  createParallelogramFootprint,
  createRectFootprint,
  createTriangleFootprint,
} from '../utils/projection';
import { SERVER_GROUND_Y } from '../utils/geometry';
import { getTransportLabelRu } from '../utils/routing';
import {
  computePolygonCentroidAndDims,
  detectParallelogramSkewFromFootprint,
  detectTriangleCornerFromFootprint,
  ensureClockwiseFootprint,
  getBuildingWings,
  normalizeAngleDeg,
  syncBuildingFromWings,
} from '../utils/buildingOps';
import { POI_ICON_CATALOG, POI_ICON_MAP } from '../utils/poiIcons';

interface EditorPanelProps {
  editorTool: EditorTool;
  mapStyle: MapStyleMode;
  terrainRelief: boolean;
  selectedEntity: SelectedEntity | null;
  routes: MtrRoute[];
  draftBuildingCenter: WorldPoint | null;
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
  onFinishBuildingPolygon?: () => void;
  onPopBuildingPolygonPoint?: () => void;
  onClearBuildingPolygon?: () => void;
  onConvertWingToFreeform?: (buildingId: string, wingId?: string) => void;
  draftStreetPoints: WorldPoint[];
  draftStreetPoints3D?: WorldPoint3D[];
  draftStreetElevationY?: number;
  draftStreetRoadClass?: RoadClass;
  draftStreetOneWay?: OneWayDirection;
  onChangeDraftStreetElevationY?: (y: number) => void;
  onChangeDraftStreetRoadClass?: (rc: RoadClass) => void;
  onChangeDraftStreetOneWay?: (ow: OneWayDirection) => void;
  draftLandPoints: WorldPoint[];
  draftLandKind?: 'park' | 'water' | 'square';
  onChangeDraftLandKind?: (kind: 'park' | 'water' | 'square') => void;
  draftPoiCenter?: WorldPoint | null;
  draftPoiIcon?: PoiIconKind;
  onChangeDraftPoiIcon?: (icon: PoiIconKind) => void;
  poisCount?: number;
  onSavePoi?: (poi: MapPoi) => void;
  onDeletePoi?: (id: string) => void;
  places?: MapPlaceLabel[];
  draftPlaceCenter?: WorldPoint | null;
  draftPlaceTier?: SettlementTier;
  onChangeDraftPlaceTier?: (tier: SettlementTier) => void;
  onSavePlace?: (place: MapPlaceLabel) => void;
  onDeletePlace?: (id: string) => void;
  onSelectPlace?: (place: MapPlaceLabel) => void;
  onResetDefaultPlaces?: () => void;
  multiSelectedItems?: MultiSelectedItem[];
  multiSelectedBuildingIds?: string[];
  multiSelectMode?: boolean;
  onToggleMultiSelectMode?: () => void;
  onRemoveMultiSelectKind?: (kind: MultiSelectKind) => void;
  onMergeMultiSelectedBuildings?: () => void;
  onClearMultiSelectBuildings?: () => void;
  onBatchDeleteMultiSelected?: () => void;
  onBatchUpdateBuildings?: (patch: {
    name?: string;
    category?: BuildingCategory;
    floors?: number;
    street?: string;
    district?: string;
    icon?: PoiIconKind | '';
    roofType?: RoofType;
    baseYDelta?: number;
  }) => void;
  onBatchUpdateStreets?: (patch: {
    name?: string;
    roadClass?: RoadClass;
    width?: number;
    oneWay?: OneWayDirection;
    reverseDirection?: boolean;
    elevationY?: number;
    elevationDelta?: number;
    district?: string;
    simAllowed?: boolean;
  }) => void;
  onBatchUpdateLandFeatures?: (patch: { kind?: 'park' | 'water' | 'square'; name?: string }) => void;
  onBatchUpdatePois?: (patch: { icon?: PoiIconKind; color?: string; description?: string }) => void;
  onBatchUpdatePlaces?: (patch: {
    tier?: SettlementTier;
    priority?: number;
    subtitle?: string;
  }) => void;
  snapToRoad: boolean;
  snapToBuilding?: boolean;
  snapToLand?: boolean;
  autoHouseNumbering?: boolean;
  onToggleAutoHouseNumbering?: () => void;
  onRenumberStreetBuildings?: (streetId: string) => void;
  lastEditorNotice: string | null;
  canUndo: boolean;
  canRedo: boolean;
  userBuildingsCount: number;
  userStreetsCount: number;
  userLandCount: number;
  movedStationsCount: number;
  movedRoutesCount: number;
  hasStationOverride: (stationId: string) => boolean;
  hasRouteOverride: (routeId: string) => boolean;
  onExitEditor: () => void;
  onChangeMapStyle: (style: MapStyleMode) => void;
  onToggleTerrainRelief: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onChangeTool: (tool: EditorTool) => void;
  onToggleSnapToRoad: () => void;
  onToggleSnapToBuilding?: () => void;
  onToggleSnapToLand?: () => void;
  onChangeDraftBuildingSize: (next: {
    width: number;
    depth: number;
    floors: number;
    angle: number;
    shape?: 'rect' | 'circle' | 'triangle' | 'parallelogram' | 'polygon';
    triangleCorner?: 0 | 1 | 2 | 3;
    skewDeg?: number;
  }) => void;
  onPopStreetPoint: () => void;
  onClearStreetPoints: () => void;
  onPopLandPoint: () => void;
  onClearLandPoints: () => void;
  onSaveBuilding: (building: Building3D) => void;
  onDeleteBuilding: (id: string) => void;
  activeWingId: string | null;
  isDrawingWing: boolean;
  mergeSourceBuildingId: string | null;
  onSelectWing: (wingId: string) => void;
  onRotateBuilding: (buildingId: string, angleDeg: number, wingId?: string) => void;
  onAddWingQuick: (buildingId: string) => void;
  onToggleDrawWing: () => void;
  onRemoveWing: (buildingId: string, wingId: string) => void;
  onToggleMergeBuilding: (buildingId: string) => void;
  onSplitBuilding: (buildingId: string) => void;
  onSaveStreet: (street: StreetSegment) => void;
  onDeleteStreet: (id: string) => void;
  onSaveLandFeature: (feature: LandFeature) => void;
  onDeleteLandFeature: (id: string) => void;
  onUpdateStationOverride: (
    stationId: string,
    override: { x: number; z: number; y?: number; name?: string }
  ) => void;
  onResetStationOverride: (stationId: string) => void;
  onResetRouteOverride: (routeId: string) => void;
  onSelectRouteById: (routeId: string) => void;
  onResetAllEdits: () => void;
  onExportJson: () => void;
  onImportJson: (jsonText: string) => { ok: boolean; message: string };
  isSelectingSynthesisArea?: boolean;
  synthesisPolygonCount?: number;
  onFinishSynthesisPolygon?: () => void;
  onPopSynthesisVertex?: () => void;
  onCancelSelectSynthesisArea?: () => void;
  synthesisPanel?: React.ReactNode;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  editorTool,
  mapStyle,
  terrainRelief,
  selectedEntity,
  routes,
  draftBuildingCenter,
  draftBuildingPolygon = [],
  draftBuildingSize,
  onFinishBuildingPolygon,
  onPopBuildingPolygonPoint,
  onClearBuildingPolygon,
  onConvertWingToFreeform,
  draftStreetPoints,
  draftStreetPoints3D,
  draftStreetElevationY = SERVER_GROUND_Y,
  draftStreetRoadClass = 'street',
  draftStreetOneWay = 'none',
  onChangeDraftStreetElevationY,
  onChangeDraftStreetRoadClass,
  onChangeDraftStreetOneWay,
  draftLandPoints,
  draftLandKind = 'park',
  onChangeDraftLandKind,
  draftPoiCenter,
  draftPoiIcon = 'star',
  onChangeDraftPoiIcon,
  poisCount = 0,
  onSavePoi,
  onDeletePoi,
  multiSelectedItems = [],
  multiSelectedBuildingIds = [],
  multiSelectMode = false,
  onToggleMultiSelectMode,
  onRemoveMultiSelectKind,
  onMergeMultiSelectedBuildings,
  onClearMultiSelectBuildings,
  onBatchDeleteMultiSelected,
  onBatchUpdateBuildings,
  onBatchUpdateStreets,
  onBatchUpdateLandFeatures,
  onBatchUpdatePois,
  onBatchUpdatePlaces,
  snapToRoad,
  snapToBuilding = true,
  snapToLand = true,
  autoHouseNumbering = true,
  onToggleAutoHouseNumbering,
  onRenumberStreetBuildings,
  lastEditorNotice,
  canUndo,
  canRedo,
  userBuildingsCount,
  userStreetsCount,
  userLandCount,
  movedStationsCount,
  movedRoutesCount,
  hasStationOverride,
  hasRouteOverride,
  onExitEditor,
  onChangeMapStyle,
  onToggleTerrainRelief,
  onUndo,
  onRedo,
  onChangeTool,
  onToggleSnapToRoad,
  onToggleSnapToBuilding,
  onToggleSnapToLand,
  onChangeDraftBuildingSize,
  onPopStreetPoint,
  onClearStreetPoints,
  onPopLandPoint,
  onClearLandPoints,
  onSaveBuilding,
  onDeleteBuilding,
  activeWingId,
  isDrawingWing,
  mergeSourceBuildingId,
  onSelectWing,
  onRotateBuilding,
  onAddWingQuick,
  onToggleDrawWing,
  onRemoveWing,
  onToggleMergeBuilding,
  onSplitBuilding,
  onSaveStreet,
  onDeleteStreet,
  onSaveLandFeature,
  onDeleteLandFeature,
  onUpdateStationOverride,
  onResetStationOverride,
  onResetRouteOverride,
  onSelectRouteById,
  onResetAllEdits,
  onExportJson,
  onImportJson,
  isSelectingSynthesisArea = false,
  synthesisPolygonCount = 0,
  onFinishSynthesisPolygon,
  onPopSynthesisVertex,
  onCancelSelectSynthesisArea,
  synthesisPanel,
  places = [],
  draftPlaceCenter = null,
  draftPlaceTier = 'district',
  onChangeDraftPlaceTier,
  onSavePlace,
  onDeletePlace,
  onSelectPlace,
  onResetDefaultPlaces,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 640
  );
  const prevSelectingRef = React.useRef(isSelectingSynthesisArea);

  useEffect(() => {
    const wasSelecting = prevSelectingRef.current;
    prevSelectingRef.current = isSelectingSynthesisArea;
    if (typeof window === 'undefined' || window.innerWidth >= 640) return;
    if (isSelectingSynthesisArea && !wasSelecting) {
      setDrawerOpen(false);
    } else if (!isSelectingSynthesisArea && wasSelecting && editorTool === 'synthesis') {
      setDrawerOpen(true);
    }
  }, [isSelectingSynthesisArea, editorTool]);

  // Building form state
  const [bId, setBId] = useState<string | null>(null);
  const [bName, setBName] = useState('');
  const [bStreet, setBStreet] = useState('');
  const [bHouse, setBHouse] = useState('');
  const [bDistrict, setBDistrict] = useState('Муроморск');
  const [bCategory, setBCategory] = useState<BuildingCategory>('residential');
  const [bIcon, setBIcon] = useState<PoiIconKind | ''>('');
  const [bRoofType, setBRoofType] = useState<RoofType>('flat');
  const [bBaseY, setBBaseY] = useState(String(SERVER_GROUND_Y));
  const [bX, setBX] = useState('10550');
  const [bZ, setBZ] = useState('-620');
  const [bDesc, setBDesc] = useState('');

  // Street form state
  const [sId, setSId] = useState<string | null>(null);
  const [sName, setSName] = useState('');
  const [sDistrict, setSDistrict] = useState('Муроморск');
  const [sClass, setSClass] = useState<RoadClass>(draftStreetRoadClass);
  const [sWidth, setSWidth] = useState(16);
  const [sElevY, setSElevY] = useState(draftStreetElevationY);
  const [sOneWay, setSOneWay] = useState<OneWayDirection>(draftStreetOneWay);
  const [sSimAllowed, setSSimAllowed] = useState(true);

  // Batch multi-selection form states
  const [batchBName, setBatchBName] = useState('');
  const [batchBCategory, setBatchBCategory] = useState<BuildingCategory | ''>('');
  const [batchBFloors, setBatchBFloors] = useState('');
  const [batchBStreet, setBatchBStreet] = useState('');
  const [batchBDistrict, setBatchBDistrict] = useState('');
  const [batchBRoof, setBatchBRoof] = useState<RoofType | ''>('');
  const [batchBIcon, setBatchBIcon] = useState<PoiIconKind | '' | '__clear__'>('');
  const [batchSName, setBatchSName] = useState('');
  const [batchSClass, setBatchSClass] = useState<RoadClass | ''>('');
  const [batchSWidth, setBatchSWidth] = useState('');
  const [batchSDistrict, setBatchSDistrict] = useState('');
  const [batchLName, setBatchLName] = useState('');
  const [batchPIcon, setBatchPIcon] = useState<PoiIconKind | ''>('');
  const [batchPSubtitle, setBatchPSubtitle] = useState('');
  const [batchPlTier, setBatchPlTier] = useState<SettlementTier | ''>('');
  const [batchPlPriority, setBatchPlPriority] = useState('');
  const [batchPlSubtitle, setBatchPlSubtitle] = useState('');

  // Land feature (park / water) form state
  const [lId, setLId] = useState<string | null>(null);
  const [lName, setLName] = useState('');
  const [lKind, setLKind] = useState<'park' | 'water' | 'square'>('park');

  // Standalone Map POI form state
  const [pId, setPId] = useState<string | null>(null);
  const [pName, setPName] = useState('');
  const [pIcon, setPIcon] = useState<PoiIconKind>(draftPoiIcon);
  const [pColor, setPColor] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pX, setPX] = useState('10550');
  const [pZ, setPZ] = useState('-620');

  // City / District Place Label form state
  const [plId, setPlId] = useState<string | null>(null);
  const [plName, setPlName] = useState('');
  const [plSubtitle, setPlSubtitle] = useState('');
  const [plTier, setPlTier] = useState<SettlementTier>(draftPlaceTier);
  const [plPriority, setPlPriority] = useState(80);
  const [plX, setPlX] = useState('10950');
  const [plZ, setPlZ] = useState('-1350');
  const [plFilter, setPlFilter] = useState<'all' | 'settlement' | 'district'>('all');
  const [plQuery, setPlQuery] = useState('');

  // Station move form state
  const [stName, setStName] = useState('');
  const [stX, setStX] = useState('');
  const [stZ, setStZ] = useState('');
  const [stY, setStY] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (editorTool === 'add-street') {
      setSElevY(draftStreetElevationY);
    }
  }, [draftStreetElevationY, editorTool]);

  useEffect(() => {
    if (editorTool === 'add-street') {
      setSClass(draftStreetRoadClass);
    }
  }, [draftStreetRoadClass, editorTool]);

  useEffect(() => {
    if (editorTool === 'add-street') {
      setSOneWay(draftStreetOneWay);
    }
  }, [draftStreetOneWay, editorTool]);

  useEffect(() => {
    if (editorTool === 'add-poi') {
      setPIcon(draftPoiIcon);
    }
  }, [draftPoiIcon, editorTool]);

  useEffect(() => {
    setErrorMsg(null);
    if (editorTool === 'add-building') {
      setBId(null);
      setBIcon('');
      return;
    }
    if (editorTool === 'add-street') {
      setSId(null);
      return;
    }
    if (editorTool === 'add-land') {
      setLId(null);
      setLKind(draftLandKind);
      return;
    }
    if (editorTool === 'add-poi') {
      if (selectedEntity?.type !== 'poi') {
        setPId(null);
      }
      return;
    }
    if (editorTool === 'add-place') {
      if (selectedEntity?.type !== 'place') {
        setPlId(null);
      }
      return;
    }
    if (selectedEntity?.type === 'building') {
      const b = selectedEntity.data;
      const wings = getBuildingWings(b);
      const activeWing = wings.find((w) => w.id === activeWingId) ?? wings[0];
      setBId(b.id);
      setBName(b.name);
      setBStreet(b.street);
      setBHouse(b.houseNumber);
      setBDistrict(b.district);
      setBCategory(b.category);
      setBIcon(b.icon ?? '');
      setBRoofType(activeWing.roofType ?? b.roofType ?? 'flat');
      setBBaseY(String(Math.round(activeWing.baseY ?? b.baseY ?? SERVER_GROUND_Y)));
      setBX(String(Math.round(activeWing.x)));
      setBZ(String(Math.round(activeWing.z)));
      setBDesc(b.description || '');

      const w = Math.max(
        1,
        Math.round(
          (activeWing.measuredWidth ??
            Math.max(...activeWing.footprint.map((p) => p.x)) -
              Math.min(...activeWing.footprint.map((p) => p.x))) * 10
        ) / 10
      );
      const d = Math.max(
        1,
        Math.round(
          (activeWing.measuredDepth ??
            Math.max(...activeWing.footprint.map((p) => p.z)) -
              Math.min(...activeWing.footprint.map((p) => p.z))) * 10
        ) / 10
      );
      const detectedShape: 'rect' | 'circle' | 'triangle' | 'parallelogram' | 'polygon' =
        activeWing.shapeType === 'freeform'
          ? 'polygon'
          : activeWing.shapeType === 'parallelogram'
          ? 'parallelogram'
          : activeWing.shapeType === 'circular' || activeWing.footprint.length >= 12
          ? 'circle'
          : activeWing.shapeType === 'triangular' || activeWing.footprint.length === 3
          ? 'triangle'
          : activeWing.footprint.length > 4
          ? 'polygon'
          : 'rect';
      const detectedCorner: 0 | 1 | 2 | 3 =
        detectedShape === 'triangle'
          ? detectTriangleCornerFromFootprint(
              activeWing.footprint,
              activeWing.x,
              activeWing.z,
              activeWing.orientationDeg ?? 0
            )
          : 0;
      const detectedSkew =
        detectedShape === 'parallelogram'
          ? activeWing.skewDeg ??
            detectParallelogramSkewFromFootprint(
              activeWing.footprint,
              activeWing.x,
              activeWing.z,
              activeWing.orientationDeg ?? 0
            )
          : 25;
      onChangeDraftBuildingSize({
        width: w,
        depth: d,
        floors: activeWing.floors,
        angle: activeWing.orientationDeg ?? 0,
        shape: detectedShape,
        triangleCorner: detectedCorner,
        skewDeg: detectedSkew,
      });
    } else if (selectedEntity?.type === 'street') {
      const st = selectedEntity.data;
      setSId(st.id);
      setSName(st.name);
      setSDistrict(st.district);
      setSClass(st.roadClass);
      setSWidth(st.width);
      setSElevY(Math.round(st.elevationY ?? SERVER_GROUND_Y));
      setSOneWay(st.oneWay ?? 'none');
      setSSimAllowed(st.simAllowed);
    } else if (selectedEntity?.type === 'land') {
      const feat = selectedEntity.data;
      setLId(feat.id);
      setLName(feat.name);
      setLKind(feat.kind);
    } else if (selectedEntity?.type === 'poi') {
      const poi = selectedEntity.data;
      setPId(poi.id);
      setPName(poi.name);
      setPIcon(poi.icon);
      setPColor(poi.color ?? '');
      setPDesc(poi.description ?? '');
      setPX(String(Math.round(poi.x)));
      setPZ(String(Math.round(poi.z)));
    } else if (selectedEntity?.type === 'station') {
      const s = selectedEntity.data;
      setStName(s.name);
      setStX(String(Math.round(s.x)));
      setStZ(String(Math.round(s.z)));
      setStY(String(Math.round(s.y)));
    } else if (selectedEntity?.type === 'place') {
      const pl = selectedEntity.data;
      setPlId(pl.id);
      setPlName(pl.name);
      setPlSubtitle(pl.subtitle ?? '');
      setPlTier(pl.tier);
      setPlPriority(pl.priority);
      setPlX(String(Math.round(pl.x)));
      setPlZ(String(Math.round(pl.z)));
    }
  }, [selectedEntity, editorTool, activeWingId]);

  useEffect(() => {
    if (editorTool === 'add-land') {
      setLKind(draftLandKind);
    }
  }, [draftLandKind, editorTool]);

  useEffect(() => {
    if (editorTool === 'add-place') {
      setPlTier(draftPlaceTier);
    }
  }, [draftPlaceTier, editorTool]);

  useEffect(() => {
    if (draftBuildingCenter && editorTool === 'add-building') {
      setBX(String(Math.round(draftBuildingCenter.x)));
      setBZ(String(Math.round(draftBuildingCenter.z)));
    }
  }, [draftBuildingCenter, editorTool]);

  useEffect(() => {
    if (draftPoiCenter && editorTool === 'add-poi') {
      setPX(String(Math.round(draftPoiCenter.x)));
      setPZ(String(Math.round(draftPoiCenter.z)));
    }
  }, [draftPoiCenter, editorTool]);

  useEffect(() => {
    if (draftPlaceCenter && editorTool === 'add-place') {
      setPlX(String(Math.round(draftPlaceCenter.x)));
      setPlZ(String(Math.round(draftPlaceCenter.z)));
    }
  }, [draftPlaceCenter, editorTool]);

  const handleSubmitBuilding = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (!bName.trim()) {
      setErrorMsg('Укажите название здания.');
      return;
    }
    const numX = Number(bX);
    const numZ = Number(bZ);
    const numBaseY = Number(bBaseY);
    if (!Number.isFinite(numX) || !Number.isFinite(numZ)) {
      setErrorMsg('Координаты должны быть числами.');
      return;
    }

    const floors = Math.max(1, Math.round(draftBuildingSize.floors));
    const width = Math.max(1, Number(draftBuildingSize.width) || 1);
    const depth = Math.max(1, Number(draftBuildingSize.depth) || 1);
    const height = Math.round(floors * 4.2 + 3);
    const baseY = Number.isFinite(numBaseY) ? Math.round(numBaseY) : SERVER_GROUND_Y;
    const angle = normalizeAngleDeg(draftBuildingSize.angle);

    const activeShape = draftBuildingSize.shape ?? 'rect';
    const triCorner = draftBuildingSize.triangleCorner ?? 0;
    const skewDeg = draftBuildingSize.skewDeg ?? 25;
    const makeFootprint = (cx: number, cz: number, segCount = 20) =>
      activeShape === 'circle'
        ? createCircleFootprint(cx, cz, width, depth, angle, segCount)
        : activeShape === 'triangle'
        ? createTriangleFootprint(cx, cz, width, depth, angle, triCorner)
        : activeShape === 'parallelogram'
        ? createParallelogramFootprint(cx, cz, width, depth, angle, skewDeg)
        : createRectFootprint(cx, cz, width, depth, angle);

    let building: Building3D;
    if (bId && selectedEntity?.type === 'building' && selectedEntity.data.id === bId) {
      const existing = selectedEntity.data;
      const existingWings = getBuildingWings(existing);
      const targetWingId = activeWingId ?? existingWings[0].id;
      const updatedWings = existingWings.map((w) => {
        if (w.id !== targetWingId) return w;
        const segCount = w.footprint.length >= 12 ? w.footprint.length : 20;
        if (activeShape === 'polygon' && w.footprint.length >= 3) {
          // Preserve sculpted freeform vertices, translating them if center X/Z was edited
          const dx = numX - w.x;
          const dz = numZ - w.z;
          const shifted = ensureClockwiseFootprint(
            w.footprint.map((p) => ({
              x: Math.round((p.x + dx) * 10) / 10,
              z: Math.round((p.z + dz) * 10) / 10,
            }))
          );
          const dims = computePolygonCentroidAndDims(shifted);
          return {
            ...w,
            x: dims.x,
            z: dims.z,
            footprint: shifted,
            shapeType: 'freeform' as const,
            measuredWidth: dims.width,
            measuredDepth: dims.depth,
            orientationDeg: angle,
            skewDeg: undefined,
            floors,
            height,
            baseY,
            roofY: baseY + height,
            roofType: bRoofType,
          };
        }
        return {
          ...w,
          x: Math.round(numX),
          z: Math.round(numZ),
          footprint: makeFootprint(numX, numZ, segCount),
          shapeType:
            activeShape === 'circle'
              ? ('circular' as const)
              : activeShape === 'triangle'
              ? ('triangular' as const)
              : activeShape === 'parallelogram'
              ? ('parallelogram' as const)
              : ('rectangular' as const),
          skewDeg: activeShape === 'parallelogram' ? skewDeg : undefined,
          measuredWidth: width,
          measuredDepth: depth,
          orientationDeg: angle,
          floors,
          height,
          baseY,
          roofY: baseY + height,
          roofType: bRoofType,
        };
      });
      building = syncBuildingFromWings(
        {
          ...existing,
          name: bName.trim(),
          street: bStreet.trim() || 'Новая улица',
          houseNumber: bHouse.trim() || '1',
          district: bDistrict.trim() || 'Муроморск',
          category: bCategory,
          icon: bIcon || undefined,
          description: bDesc.trim() || undefined,
        },
        updatedWings
      );
    } else {
      const polyFootprint =
        activeShape === 'polygon' && draftBuildingPolygon.length >= 3
          ? ensureClockwiseFootprint(draftBuildingPolygon)
          : makeFootprint(numX, numZ, 20);
      const polyDims =
        activeShape === 'polygon' && draftBuildingPolygon.length >= 3
          ? computePolygonCentroidAndDims(polyFootprint)
          : null;
      building = {
        id: bId || `user-b-${Date.now()}`,
        name: bName.trim(),
        street: bStreet.trim() || 'Новая улица',
        houseNumber: bHouse.trim() || '1',
        district: bDistrict.trim() || 'Муроморск',
        category: bCategory,
        icon: bIcon || undefined,
        x: polyDims ? polyDims.x : Math.round(numX),
        z: polyDims ? polyDims.z : Math.round(numZ),
        footprint: polyFootprint,
        shapeType:
          activeShape === 'circle'
            ? 'circular'
            : activeShape === 'triangle'
            ? 'triangular'
            : activeShape === 'parallelogram'
            ? 'parallelogram'
            : activeShape === 'polygon'
            ? 'freeform'
            : 'rectangular',
        skewDeg: activeShape === 'parallelogram' ? skewDeg : undefined,
        measuredWidth: polyDims ? polyDims.width : width,
        measuredDepth: polyDims ? polyDims.depth : depth,
        orientationDeg: angle,
        floors,
        height,
        baseY,
        roofY: baseY + height,
        roofType: bRoofType,
        description: bDesc.trim() || undefined,
        isUserEdited: true,
      };
      if (activeShape === 'polygon' && draftBuildingPolygon.length >= 3) {
        onClearBuildingPolygon?.();
      }
    }

    onSaveBuilding(building);
    setStatusMsg(bId ? 'Изменения здания сохранены' : 'Здание добавлено на карту');
    if (!bId) {
      setBName('');
      setBHouse('');
      setBDesc('');
    }
  };

  const handleSubmitStreet = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (!sName.trim()) {
      setErrorMsg('Введите название дороги.');
      return;
    }

    const isEditingExisting = editorTool === 'select' && selectedEntity?.type === 'street';
    const points = isEditingExisting ? selectedEntity.data.points : draftStreetPoints;

    if (points.length < 2) {
      setErrorMsg('Поставьте минимум 2 точки на карте, чтобы проложить дорогу.');
      return;
    }

    const roundedElev = Math.round(sElevY);
    let points3D: WorldPoint3D[] | undefined;
    if (isEditingExisting && selectedEntity?.type === 'street') {
      const oldElev = Math.round(selectedEntity.data.elevationY ?? SERVER_GROUND_Y);
      const deltaY = roundedElev - oldElev;
      if (selectedEntity.data.points3D && selectedEntity.data.points3D.length === points.length) {
        points3D =
          deltaY === 0
            ? selectedEntity.data.points3D
            : selectedEntity.data.points3D.map((p) => ({ ...p, y: p.y + deltaY }));
      }
    } else if (draftStreetPoints3D && draftStreetPoints3D.length === points.length) {
      points3D = draftStreetPoints3D;
    }

    const street: StreetSegment = {
      id: sId || `user-st-${Date.now()}`,
      name: sName.trim(),
      district: sDistrict.trim() || 'Муроморск',
      roadClass: sClass,
      width: Math.max(1, Number(sWidth) || 14),
      elevationY: roundedElev,
      oneWay:
        sClass === 'pedestrian' || sClass === 'railway'
          ? 'none'
          : sOneWay,
      simAllowed: sClass === 'pedestrian' || sClass === 'railway' ? false : sSimAllowed,
      points,
      points3D,
      isUserEdited: true,
    };

    onSaveStreet(street);
    setStatusMsg(sId ? 'Дорога обновлена' : 'Дорога добавлена на карту');
    if (!sId) {
      setSName('');
      onClearStreetPoints();
    }
  };

  const handleSubmitPoi = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!onSavePoi) return;
    const x = Number(pX);
    const z = Number(pZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      setErrorMsg('Координаты метки должны быть числами.');
      return;
    }
    const meta = POI_ICON_MAP[pIcon] ?? POI_ICON_MAP.star;
    const poi: MapPoi = {
      id: pId || `user-poi-${Date.now()}`,
      name: pName.trim() || meta.shortLabel,
      icon: pIcon,
      color: pColor || undefined,
      description: pDesc.trim() || undefined,
      x: Math.round(x),
      z: Math.round(z),
      isUserEdited: true,
    };
    onSavePoi(poi);
    setStatusMsg(pId ? 'Метка обновлена' : 'Метка добавлена на карту');
    if (!pId) {
      setPName('');
      setPDesc('');
    }
  };

  const handleSubmitLand = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    const polygon =
      editorTool === 'select' && selectedEntity?.type === 'land'
        ? selectedEntity.data.polygon
        : draftLandPoints;

    if (polygon.length < 3) {
      setErrorMsg('Поставьте минимум 3 точки на карте, чтобы замкнуть контур.');
      return;
    }

    const kind = lKind;

    const feature: LandFeature = {
      id: lId || `user-land-${Date.now()}`,
      name:
        lName.trim() ||
        (kind === 'water' ? 'Водоём' : kind === 'park' ? 'Сквер' : 'Площадь'),
      kind,
      polygon,
      isUserEdited: true,
    };

    onSaveLandFeature(feature);
    setStatusMsg(
      lId
        ? 'Контур обновлён'
        : kind === 'water'
          ? 'Водоём добавлен'
          : kind === 'park'
            ? 'Парк добавлен'
            : 'Площадь добавлена'
    );
    if (!lId) {
      setLName('');
      onClearLandPoints();
    }
  };

  const handleSubmitStation = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEntity?.type !== 'station') return;
    const x = Number(stX);
    const z = Number(stZ);
    const y = Number(stY);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      setErrorMsg('Введите корректные координаты.');
      return;
    }
    onUpdateStationOverride(selectedEntity.data.id, {
      x: Math.round(x),
      z: Math.round(z),
      y: Number.isFinite(y) ? Math.round(y) : selectedEntity.data.y,
      name: stName.trim() || selectedEntity.data.name,
    });
    setStatusMsg('Положение остановки сохранено (данные маршрутов сохранены)');
  };

  const handleSubmitPlace = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!onSavePlace) return;
    const x = Number(plX);
    const z = Number(plZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      setErrorMsg('Введите корректные координаты X и Z.');
      return;
    }
    const cleanName = plName.trim();
    if (!cleanName) {
      setErrorMsg('Введите название города или района.');
      return;
    }
    const saved: MapPlaceLabel = {
      id: plId || `user-place-${Date.now()}`,
      name: cleanName,
      subtitle: plSubtitle.trim() || undefined,
      x: Math.round(x),
      z: Math.round(z),
      tier: plTier,
      priority: Math.max(10, Math.min(100, Math.round(Number(plPriority) || 75))),
      isUserEdited: true,
    };
    onSavePlace(saved);
    setStatusMsg(plId ? 'Надпись города/района обновлена' : 'Надпись добавлена на карту');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = onImportJson(String(reader.result || ''));
      if (res.ok) {
        setStatusMsg(res.message);
        setErrorMsg(null);
      } else {
        setErrorMsg(res.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const isMultiSelectActive =
    editorTool === 'select' &&
    (multiSelectedItems.length >= 2 || (multiSelectMode && multiSelectedItems.length >= 1));
  const multiBuildingCount = multiSelectedItems.filter((it) => it.type === 'building').length;
  const multiStreetCount = multiSelectedItems.filter((it) => it.type === 'street').length;
  const multiLandCount = multiSelectedItems.filter((it) => it.type === 'land').length;
  const multiPoiCount = multiSelectedItems.filter((it) => it.type === 'poi').length;
  const multiPlaceCount = multiSelectedItems.filter((it) => it.type === 'place').length;

  const showBuildingForm =
    !isMultiSelectActive &&
    (editorTool === 'add-building' ||
      (editorTool === 'select' && selectedEntity?.type === 'building'));

  const showStreetForm =
    !isMultiSelectActive &&
    (editorTool === 'add-street' ||
      (editorTool === 'select' && selectedEntity?.type === 'street'));

  const showLandForm =
    !isMultiSelectActive &&
    (editorTool === 'add-land' ||
      (editorTool === 'select' && selectedEntity?.type === 'land'));

  const showPoiForm =
    !isMultiSelectActive &&
    (editorTool === 'add-poi' ||
      (editorTool === 'select' && selectedEntity?.type === 'poi'));

  const showPlaceForm =
    !isMultiSelectActive &&
    (editorTool === 'add-place' ||
      (editorTool === 'select' && selectedEntity?.type === 'place'));

  const showStationForm =
    !isMultiSelectActive &&
    (editorTool === 'select' || editorTool === 'move-transit') &&
    selectedEntity?.type === 'station';

  const showRouteForm =
    !isMultiSelectActive &&
    (editorTool === 'select' || editorTool === 'move-transit') &&
    selectedEntity?.type === 'route';

  const filteredPlacesList = places.filter((pl) => {
    if (plFilter === 'district' && pl.tier !== 'district') return false;
    if (plFilter === 'settlement' && pl.tier === 'district') return false;
    const q = plQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      pl.name.toLowerCase().includes(q) ||
      (pl.subtitle && pl.subtitle.toLowerCase().includes(q))
    );
  });

  const TOOLS: Array<{ id: EditorTool; label: string; icon: React.ComponentType<{ className?: string }>; danger?: boolean }> = [
    { id: 'select', label: 'Выбор', icon: MousePointerClick },
    { id: 'add-building', label: 'Здание', icon: Building2 },
    { id: 'add-street', label: 'Дорога / ЖД', icon: RouteIcon },
    { id: 'add-poi', label: 'Метка', icon: MapPin },
    { id: 'add-place', label: 'Города / Районы', icon: Type },
    { id: 'add-land', label: 'Территории', icon: Trees },
    { id: 'move-transit', label: 'Линии и остановки', icon: TrainFront },
    { id: 'synthesis', label: 'Синтез', icon: Cpu },
    { id: 'delete-area', label: 'Ластик', icon: Eraser, danger: true },
  ];

  return (
    <>
      {/* Top Yandex Map Editor Command Bar */}
      <header
        aria-label="Панель инструментов редактора карты"
        className="fixed top-0 left-0 right-0 min-h-14 sm:h-14 py-2 sm:py-0 z-30 bg-white dark:bg-[#1E2027] border-b border-neutral-200 dark:border-neutral-700/80 shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-3 sm:px-4 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1.5 sm:gap-3 murs-anim-slide-down"
      >
        {/* Zone 1: Back to Map & Editor Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onExitEditor}
            className="h-9 px-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-[#2B2E37] dark:hover:bg-[#353945] text-neutral-900 dark:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>На карту</span>
          </button>
          <div className="hidden lg:flex items-center gap-2">
            <span
              className="w-7 h-7 rounded-lg bg-sky-50/90 dark:bg-sky-950/45 border border-sky-200/80 dark:border-sky-500/25 flex items-center justify-center shrink-0 p-0.5"
              aria-hidden="true"
            >
              <img
                src="/assets/aistudio/____________8ba2e7f1.png"
                alt=""
                className="w-full h-full object-contain select-none"
                draggable={false}
              />
            </span>
            <span className="text-sm font-bold text-neutral-950 dark:text-white whitespace-nowrap">
              MURMaps · Редактор
            </span>
          </div>
        </div>

        {/* Zone 2: Graphical Drawing & Editing Tool Strip */}
        <div
          role="toolbar"
          aria-label="Инструменты графического редактирования"
          className="order-3 sm:order-none w-full sm:w-auto flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-[#282B33] overflow-x-auto max-w-full"
        >
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = editorTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onChangeTool(t.id);
                  if (t.id === 'synthesis' || typeof window === 'undefined' || window.innerWidth >= 640) {
                    setDrawerOpen(true);
                  }
                  setErrorMsg(null);
                  setStatusMsg(null);
                }}
                className={`min-h-[38px] sm:min-h-[32px] h-9 sm:h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? t.danger
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'bg-[#FFCC00] text-neutral-950 shadow-sm'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-white/70 dark:hover:bg-[#1E2027]/70 hover:text-neutral-950 dark:hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Zone 3: Quick Editor Actions (Undo, Redo, Hybrid, Relief) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label="Отменить"
              title="Отменить последнее действие (Ctrl+Z)"
              className="h-9 px-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 flex items-center gap-1 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">Отменить</span>
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label="Вернуть"
              title="Вернуть отменённое действие (Ctrl+Y / Ctrl+Shift+Z)"
              className="h-9 px-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 flex items-center gap-1 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">Вернуть</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onChangeMapStyle(mapStyle === 'hybrid' ? 'vector' : 'hybrid')}
            title="Переключить подложку спутника (Гибрид)"
            className={`h-9 px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              mapStyle === 'hybrid'
                ? 'bg-[#FFCC00] text-neutral-950 border-[#E5B800]'
                : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            <Layers2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden md:inline">Гибрид</span>
          </button>

          <button
            type="button"
            onClick={onToggleTerrainRelief}
            title="Показать / скрыть рельеф местности"
            className={`h-9 px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              terrainRelief
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            <Mountain className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">Рельеф</span>
          </button>
        </div>
      </header>

      {/* Floating Selection Hint Banner while drawing an arbitrary Synthesis Polygon */}
      {isSelectingSynthesisArea && editorTool === 'synthesis' && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-24px)]"
        >
          <div className="px-3.5 py-2 rounded-2xl bg-neutral-900/95 text-white border border-[#FFCC00]/60 shadow-[0_8px_28px_rgba(0,0,0,0.28)] flex items-center gap-2.5 text-xs font-semibold murs-anim-slide-up">
            <span className="text-[#FFCC00] truncate">
              Контур синтеза ({synthesisPolygonCount ?? 0} т.) · ЛКМ или Shift+ЛКМ — точка
            </span>
            {(synthesisPolygonCount ?? 0) >= 3 && onFinishSynthesisPolygon && (
              <button
                type="button"
                onClick={onFinishSynthesisPolygon}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shrink-0 transition-colors"
              >
                Готово
              </button>
            )}
            {(synthesisPolygonCount ?? 0) > 0 && onPopSynthesisVertex && (
              <button
                type="button"
                onClick={onPopSynthesisVertex}
                className="px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold shrink-0 transition-colors"
              >
                Назад
              </button>
            )}
            {onCancelSelectSynthesisArea && (
              <button
                type="button"
                onClick={onCancelSelectSynthesisArea}
                className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold shrink-0 transition-colors"
              >
                Отмена
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mobile Floating Inspector Toggle Pill when collapsed */}
      {!drawerOpen && !isSelectingSynthesisArea && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Свойства редактора"
          className="sm:hidden fixed bottom-4 left-3 z-30 min-h-[44px] px-4 rounded-2xl bg-white dark:bg-[#1E2027] border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_6px_24px_rgba(0,0,0,0.16)] flex items-center gap-2 text-xs font-bold text-neutral-950 dark:text-white murs-anim-slide-up"
        >
          <Building2 className="w-4 h-4 text-[#FC3F1D]" aria-hidden="true" />
          <span>Свойства</span>
        </button>
      )}

      {/* Contextual Object Inspector Drawer (Desktop left drawer / Mobile bottom sheet) */}
      <aside
        aria-label="Свойства объекта в редакторе"
        className={`fixed inset-x-0 bottom-0 sm:inset-auto sm:top-[68px] sm:left-4 sm:bottom-4 z-30 sm:z-20 flex transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          drawerOpen
            ? 'translate-y-0 sm:translate-x-0'
            : 'translate-y-full sm:translate-y-0 sm:-translate-x-[calc(100%+16px)] pointer-events-none sm:pointer-events-auto'
        }`}
      >
        <div
          className={`${
            editorTool === 'synthesis' ? 'sm:w-[356px]' : 'sm:w-[332px]'
          } w-full max-h-[66vh] sm:max-h-none sm:h-full rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#1E2027] border border-neutral-200/90 dark:border-neutral-700/80 shadow-[0_-8px_32px_rgba(0,0,0,0.16)] sm:shadow-[0_8px_32px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden pointer-events-auto transition-[width] duration-200 ease-out murs-anim-slide-right`}
        >
          <div className="px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-700/80 flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-neutral-900 dark:text-white truncate">
              {editorTool === 'synthesis'
                ? 'Синтез объектов карты'
                : isMultiSelectActive
                ? `Групповое редактирование (${multiSelectedItems.length})`
                : showBuildingForm
                ? bId
                  ? 'Свойства здания'
                  : 'Новое здание'
                : showStreetForm
                ? sId
                  ? 'Свойства дороги'
                  : 'Новая дорога'
                : showLandForm
                ? lId
                  ? 'Свойства территории'
                  : lKind === 'water'
                  ? 'Новый водоём'
                  : lKind === 'square'
                  ? 'Новая площадь'
                  : 'Новый парк / сквер'
                : showPoiForm
                ? pId
                  ? 'Свойства метки'
                  : 'Новая метка на карте'
                : showPlaceForm
                ? plId
                  ? 'Свойства подписи'
                  : 'Города и районы'
                : showStationForm
                ? 'Остановка / станция'
                : showRouteForm
                ? 'Линия транспорта'
                : editorTool === 'delete-area'
                ? 'Ластик объектов'
                : editorTool === 'move-transit'
                ? 'Редактирование линий и остановок'
                : 'Инспектор объектов'}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
                {userBuildingsCount} зд. · {userStreetsCount} ул.{poisCount > 0 ? ` · ${poisCount} м.` : ''}
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Свернуть панель свойств"
                className="sm:hidden w-8 h-8 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-neutral-700 dark:text-neutral-200 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {editorTool === 'synthesis' && synthesisPanel ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {synthesisPanel}
            </div>
          ) : (
            <div
              key={`${editorTool}:${isMultiSelectActive ? 'multi' : selectedEntity?.type ?? 'none'}`}
              className="flex-1 overflow-y-auto murs-scroll px-4 py-3 space-y-3 murs-anim-tab"
            >
            {errorMsg && (
              <div
                role="alert"
                className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 murs-anim-pop"
              >
                {errorMsg}
              </div>
            )}
            {(statusMsg || lastEditorNotice) && (
              <div
                role="status"
                className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 murs-anim-pop"
              >
                {statusMsg || lastEditorNotice}
              </div>
            )}

            {/* Select Tool Multi-Selection Mode Toggle Bar */}
            {editorTool === 'select' && onToggleMultiSelectMode && (
              <div
                className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition-colors ${
                  multiSelectMode || isMultiSelectActive
                    ? 'bg-sky-50/90 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700'
                    : 'bg-neutral-50 dark:bg-[#252830] border-neutral-200/80 dark:border-neutral-700/70'
                }`}
              >
                <button
                  type="button"
                  onClick={onToggleMultiSelectMode}
                  aria-pressed={multiSelectMode}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                >
                  <span
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      multiSelectMode || isMultiSelectActive
                        ? 'bg-sky-600 text-white'
                        : 'bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    <CheckSquare className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white leading-tight truncate">
                      Мультивыделение
                    </div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight truncate mt-0.5">
                      {multiSelectMode
                        ? 'ЛКМ или рамка — добавить объекты'
                        : 'Shift + ЛКМ или Shift + рамка'}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={onToggleMultiSelectMode}
                  className={`h-7 px-2.5 rounded-lg text-[11px] font-bold transition-colors shrink-0 ${
                    multiSelectMode
                      ? 'bg-sky-600 hover:bg-sky-700 text-white'
                      : 'bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200'
                  }`}
                >
                  {multiSelectMode ? 'Вкл' : 'Включить'}
                </button>
              </div>
            )}

            {/* Empty multi-select mode hint when toggled on with 0 items */}
            {editorTool === 'select' && multiSelectMode && multiSelectedItems.length === 0 && (
              <div className="p-3 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-xs text-sky-900 dark:text-sky-200 leading-relaxed">
                Кликайте по любым зданиям, дорогам, территориям, меткам или подписям — либо
                растяните рамку ЛКМ, чтобы выделить сразу несколько объектов для группового
                редактирования.
              </div>
            )}

            {/* Universal Multi-Selection Batch Inspector (Shift + LMB / Marquee) */}
            {isMultiSelectActive && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-700 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-sky-950 dark:text-sky-100">
                      Выделено объектов: {multiSelectedItems.length}
                    </span>
                    {onClearMultiSelectBuildings && (
                      <button
                        type="button"
                        onClick={onClearMultiSelectBuildings}
                        className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 hover:underline"
                      >
                        Сброс (Esc)
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-medium text-sky-900/90 dark:text-sky-200/90">
                    {(
                      [
                        { kind: 'building', label: 'Зданий', count: multiBuildingCount },
                        { kind: 'street', label: 'Дорог', count: multiStreetCount },
                        { kind: 'land', label: 'Территорий', count: multiLandCount },
                        { kind: 'poi', label: 'Меток', count: multiPoiCount },
                        { kind: 'place', label: 'Подписей', count: multiPlaceCount },
                      ] as const
                    )
                      .filter((g) => g.count > 0)
                      .map((g) => (
                        <span
                          key={g.kind}
                          className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-white/85 dark:bg-[#1B1E24] border border-sky-200 dark:border-sky-800"
                        >
                          <span>
                            {g.label}: {g.count}
                          </span>
                          {onRemoveMultiSelectKind && (
                            <button
                              type="button"
                              onClick={() => onRemoveMultiSelectKind(g.kind)}
                              title={`Убрать «${g.label}» из выделения`}
                              aria-label={`Убрать ${g.label} из выделения`}
                              className="w-4 h-4 rounded hover:bg-sky-100 dark:hover:bg-sky-900/60 flex items-center justify-center text-sky-700 dark:text-sky-300"
                            >
                              <X className="w-2.5 h-2.5" aria-hidden="true" />
                            </button>
                          )}
                        </span>
                      ))}
                  </div>
                  <p className="text-[11px] text-sky-900/80 dark:text-sky-200/80 leading-snug">
                    <b>Shift + ЛКМ</b> — добавить или снять объект; <b>Shift + рамка</b> — выделить
                    область.
                  </p>

                  <div className="flex items-center gap-1.5">
                    {multiBuildingCount >= 2 && onMergeMultiSelectedBuildings && (
                      <button
                        type="button"
                        onClick={onMergeMultiSelectedBuildings}
                        className="flex-1 h-9 px-2.5 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <Merge className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Объединить ({multiBuildingCount})</span>
                      </button>
                    )}
                    {onBatchDeleteMultiSelected && (
                      <button
                        type="button"
                        onClick={onBatchDeleteMultiSelected}
                        className={`${
                          multiBuildingCount >= 2 ? 'px-3' : 'flex-1 px-3'
                        } h-9 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap`}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Удалить все ({multiSelectedItems.length})</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Batch Building Editor */}
                {multiBuildingCount > 0 && onBatchUpdateBuildings && (
                  <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2.5">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#FC3F1D]" aria-hidden="true" />
                      <span>Изменить здания ({multiBuildingCount})</span>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        Название
                      </label>
                      <input
                        type="text"
                        placeholder="Не менять"
                        value={batchBName}
                        onChange={(e) => setBatchBName(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Категория
                        </label>
                        <select
                          value={batchBCategory}
                          onChange={(e) => setBatchBCategory(e.target.value as BuildingCategory | '')}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                        >
                          <option value="">Без изменений</option>
                          <option value="residential">Жилой дом</option>
                          <option value="civic">Администрация</option>
                          <option value="commercial">Торговля / ТЦ</option>
                          <option value="transport">Транспорт</option>
                          <option value="medical">Медицина</option>
                          <option value="culture">Культура / спорт</option>
                          <option value="education">Образование</option>
                          <option value="industrial">Промышленность</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Этажность
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          placeholder="—"
                          value={batchBFloors}
                          onChange={(e) => setBatchBFloors(e.target.value)}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Улица
                        </label>
                        <input
                          type="text"
                          placeholder="Не менять"
                          value={batchBStreet}
                          onChange={(e) => setBatchBStreet(e.target.value)}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Район
                        </label>
                        <input
                          type="text"
                          placeholder="Не менять"
                          value={batchBDistrict}
                          onChange={(e) => setBatchBDistrict(e.target.value)}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Крыша
                        </label>
                        <select
                          value={batchBRoof}
                          onChange={(e) => setBatchBRoof(e.target.value as RoofType | '')}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                        >
                          <option value="">Без изменений</option>
                          <option value="flat">Плоская</option>
                          <option value="pitched">Скатная</option>
                          <option value="curved">Кривая</option>
                          <option value="complex">Сложная</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Символ
                        </label>
                        <select
                          value={batchBIcon}
                          onChange={(e) => setBatchBIcon(e.target.value as PoiIconKind | '' | '__clear__')}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                        >
                          <option value="">Без изменений</option>
                          <option value="__clear__">Авто (по типу)</option>
                          {POI_ICON_CATALOG.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.shortLabel}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onBatchUpdateBuildings({ baseYDelta: -1 })}
                        className="h-7 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200"
                      >
                        Опустить −1 м Y
                      </button>
                      <button
                        type="button"
                        onClick={() => onBatchUpdateBuildings({ baseYDelta: 1 })}
                        className="h-7 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200"
                      >
                        Поднять +1 м Y
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const patch: {
                          name?: string;
                          category?: BuildingCategory;
                          floors?: number;
                          street?: string;
                          district?: string;
                          icon?: PoiIconKind | '';
                          roofType?: RoofType;
                        } = {};
                        if (batchBName.trim()) patch.name = batchBName.trim();
                        if (batchBCategory) patch.category = batchBCategory;
                        if (batchBFloors.trim() && Number.isFinite(Number(batchBFloors))) {
                          patch.floors = Math.max(1, Math.min(120, Math.round(Number(batchBFloors))));
                        }
                        if (batchBStreet.trim()) patch.street = batchBStreet.trim();
                        if (batchBDistrict.trim()) patch.district = batchBDistrict.trim();
                        if (batchBRoof) patch.roofType = batchBRoof;
                        if (batchBIcon === '__clear__') patch.icon = '';
                        else if (batchBIcon) patch.icon = batchBIcon;
                        if (Object.keys(patch).length > 0) {
                          onBatchUpdateBuildings(patch);
                          setBatchBName('');
                          setBatchBCategory('');
                          setBatchBFloors('');
                          setBatchBStreet('');
                          setBatchBDistrict('');
                          setBatchBRoof('');
                          setBatchBIcon('');
                        }
                      }}
                      className="w-full h-8 px-3 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold transition-colors"
                    >
                      Применить к зданиям
                    </button>
                  </div>
                )}

                {/* Batch Street Editor (incl. One-Way Traffic, Name & Car Access) */}
                {multiStreetCount > 0 && onBatchUpdateStreets && (
                  <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2.5">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                      <RouteIcon className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                      <span>Изменить дороги ({multiStreetCount})</span>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        Название дороги / улицы
                      </label>
                      <input
                        type="text"
                        placeholder="Не менять"
                        value={batchSName}
                        onChange={(e) => setBatchSName(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                      />
                    </div>

                    {/* Quick One-Way Buttons for all selected road segments */}
                    <div>
                      <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        Одностороннее движение
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <button
                          type="button"
                          onClick={() => onBatchUpdateStreets({ oneWay: 'none' })}
                          className="h-8 px-1.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1"
                        >
                          <ArrowLeftRight className="w-3 h-3" aria-hidden="true" />
                          <span>Двуст.</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onBatchUpdateStreets({ oneWay: 'forward' })}
                          className="h-8 px-1.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-[11px] font-semibold text-sky-700 dark:text-sky-300 flex items-center justify-center gap-1"
                        >
                          <span>Вперёд</span>
                          <ArrowRight className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onBatchUpdateStreets({ oneWay: 'reverse' })}
                          className="h-8 px-1.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-[11px] font-semibold text-sky-700 dark:text-sky-300 flex items-center justify-center gap-1"
                        >
                          <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                          <span>Обратно</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1 mt-1">
                        <button
                          type="button"
                          onClick={() => onBatchUpdateStreets({ reverseDirection: true })}
                          className="h-7 px-1.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200"
                        >
                          Развернуть
                        </button>
                        <button
                          type="button"
                          onClick={() => onBatchUpdateStreets({ simAllowed: true })}
                          className="h-7 px-1.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                        >
                          Авто: да
                        </button>
                        <button
                          type="button"
                          onClick={() => onBatchUpdateStreets({ simAllowed: false })}
                          className="h-7 px-1.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-red-50 dark:hover:bg-red-950/40 text-[11px] font-semibold text-red-700 dark:text-red-300"
                        >
                          Авто: нет
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Класс дороги
                        </label>
                        <select
                          value={batchSClass}
                          onChange={(e) => setBatchSClass(e.target.value as RoadClass | '')}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                        >
                          <option value="">Без изменений</option>
                          <option value="highway">Магистраль</option>
                          <option value="avenue">Проспект</option>
                          <option value="embankment">Набережная</option>
                          <option value="street">Улица</option>
                          <option value="lane">Переулок</option>
                          <option value="service">Подъездная / дворовая</option>
                          <option value="dirt">Грунтовая дорога</option>
                          <option value="pedestrian">Пешеходная</option>
                          <option value="railway">ЖД путь / рельсы</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Ширина (м)
                        </label>
                        <input
                          type="number"
                          min={1}
                          placeholder="—"
                          value={batchSWidth}
                          onChange={(e) => setBatchSWidth(e.target.value)}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => onBatchUpdateStreets({ elevationDelta: -2 })}
                        className="h-7 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200"
                      >
                        −2 м Y
                      </button>
                      <button
                        type="button"
                        onClick={() => onBatchUpdateStreets({ elevationY: SERVER_GROUND_Y })}
                        className="h-7 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200"
                      >
                        Земля (0)
                      </button>
                      <button
                        type="button"
                        onClick={() => onBatchUpdateStreets({ elevationDelta: 2 })}
                        className="h-7 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200"
                      >
                        +2 м Y
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        Район
                      </label>
                      <input
                        type="text"
                        placeholder="Не менять"
                        value={batchSDistrict}
                        onChange={(e) => setBatchSDistrict(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const patch: {
                          name?: string;
                          roadClass?: RoadClass;
                          width?: number;
                          district?: string;
                        } = {};
                        if (batchSName.trim()) patch.name = batchSName.trim();
                        if (batchSClass) patch.roadClass = batchSClass;
                        if (batchSWidth.trim() && Number.isFinite(Number(batchSWidth))) {
                          patch.width = Math.max(1, Math.round(Number(batchSWidth)));
                        }
                        if (batchSDistrict.trim()) patch.district = batchSDistrict.trim();
                        if (Object.keys(patch).length > 0) {
                          onBatchUpdateStreets(patch);
                          setBatchSName('');
                          setBatchSClass('');
                          setBatchSWidth('');
                          setBatchSDistrict('');
                        }
                      }}
                      className="w-full h-8 px-3 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold transition-colors"
                    >
                      Применить к дорогам
                    </button>
                  </div>
                )}

                {/* Batch Land Feature Editor */}
                {multiLandCount > 0 && onBatchUpdateLandFeatures && (
                  <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                      <Trees className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      <span>Изменить территории ({multiLandCount})</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { id: 'park', label: 'Парк' },
                          { id: 'water', label: 'Водоём' },
                          { id: 'square', label: 'Площадь' },
                        ] as const
                      ).map((k) => (
                        <button
                          key={k.id}
                          type="button"
                          onClick={() => onBatchUpdateLandFeatures({ kind: k.id })}
                          className="h-8 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-800 dark:text-neutral-200"
                        >
                          {k.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="Новое название…"
                        value={batchLName}
                        onChange={(e) => setBatchLName(e.target.value)}
                        className="flex-1 h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                      />
                      <button
                        type="button"
                        disabled={!batchLName.trim()}
                        onClick={() => {
                          if (!batchLName.trim()) return;
                          onBatchUpdateLandFeatures({ name: batchLName.trim() });
                          setBatchLName('');
                        }}
                        className="h-8 px-3 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] disabled:opacity-50 text-neutral-950 text-xs font-bold"
                      >
                        ОК
                      </button>
                    </div>
                  </div>
                )}

                {/* Batch POI Editor */}
                {multiPoiCount > 0 && onBatchUpdatePois && (
                  <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2.5">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#FC3F1D]" aria-hidden="true" />
                      <span>Изменить метки ({multiPoiCount})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={batchPIcon}
                        onChange={(e) => setBatchPIcon(e.target.value as PoiIconKind | '')}
                        className="flex-1 h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                      >
                        <option value="">Выберите символ…</option>
                        {POI_ICON_CATALOG.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!batchPIcon}
                        onClick={() => {
                          if (!batchPIcon) return;
                          onBatchUpdatePois({ icon: batchPIcon });
                          setBatchPIcon('');
                        }}
                        className="h-8 px-3 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] disabled:opacity-50 text-neutral-950 text-xs font-bold"
                      >
                        ОК
                      </button>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        Цвет метки
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {['#FC3F1D', '#2563EB', '#059669', '#D97706', '#7C3AED', '#0F172A'].map(
                          (hex) => (
                            <button
                              key={hex}
                              type="button"
                              onClick={() => onBatchUpdatePois({ color: hex })}
                              title={`Применить цвет ${hex}`}
                              aria-label={`Цвет ${hex}`}
                              className="w-6 h-6 rounded-full border border-white/80 dark:border-neutral-600 shadow-sm hover:scale-110 transition-transform"
                              style={{ backgroundColor: hex }}
                            />
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => onBatchUpdatePois({ color: '' })}
                          className="h-6 px-2 rounded-md bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-[10px] font-semibold text-neutral-700 dark:text-neutral-300"
                        >
                          Авто
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="Подпись / описание…"
                        value={batchPSubtitle}
                        onChange={(e) => setBatchPSubtitle(e.target.value)}
                        className="flex-1 h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                      />
                      <button
                        type="button"
                        disabled={!batchPSubtitle.trim()}
                        onClick={() => {
                          if (!batchPSubtitle.trim()) return;
                          onBatchUpdatePois({ description: batchPSubtitle.trim() });
                          setBatchPSubtitle('');
                        }}
                        className="h-8 px-3 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] disabled:opacity-50 text-neutral-950 text-xs font-bold"
                      >
                        ОК
                      </button>
                    </div>
                  </div>
                )}

                {/* Batch Place Labels Editor (Cities / Towns / Villages / Districts) */}
                {multiPlaceCount > 0 && onBatchUpdatePlaces && (
                  <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2.5">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                      <Type className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
                      <span>Изменить подписи ({multiPlaceCount})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Тип подписи
                        </label>
                        <select
                          value={batchPlTier}
                          onChange={(e) => setBatchPlTier(e.target.value as SettlementTier | '')}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                        >
                          <option value="">Без изменений</option>
                          <option value="city">Город</option>
                          <option value="town">Посёлок</option>
                          <option value="village">Деревня</option>
                          <option value="district">Район</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                          Приоритет (1–100)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          placeholder="—"
                          value={batchPlPriority}
                          onChange={(e) => setBatchPlPriority(e.target.value)}
                          className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        Пояснение / подзаголовок
                      </label>
                      <input
                        type="text"
                        placeholder="Не менять"
                        value={batchPlSubtitle}
                        onChange={(e) => setBatchPlSubtitle(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-900 dark:text-neutral-100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const patch: {
                          tier?: SettlementTier;
                          priority?: number;
                          subtitle?: string;
                        } = {};
                        if (batchPlTier) patch.tier = batchPlTier;
                        if (batchPlPriority.trim() && Number.isFinite(Number(batchPlPriority))) {
                          patch.priority = Math.max(1, Math.min(100, Math.round(Number(batchPlPriority))));
                        }
                        if (batchPlSubtitle.trim()) patch.subtitle = batchPlSubtitle.trim();
                        if (Object.keys(patch).length > 0) {
                          onBatchUpdatePlaces(patch);
                          setBatchPlTier('');
                          setBatchPlPriority('');
                          setBatchPlSubtitle('');
                        }
                      }}
                      className="w-full h-8 px-3 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold transition-colors"
                    >
                      Применить к подписям
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Eraser Mode */}
            {editorTool === 'delete-area' && (
              <div className="p-3 rounded-xl bg-red-50/80 dark:bg-red-950/30 border border-red-200 dark:border-red-800/70 space-y-2">
                <div className="text-xs font-bold text-red-800 dark:text-red-300">
                  Удаление зданий, дорог, парков и водоёмов
                </div>
                <p className="text-xs text-red-700/90 dark:text-red-300/80 leading-relaxed">
                  Нажмите на любое здание, дорогу, парк или водоём для мгновенного удаления, либо
                  зажмите ЛКМ и растяните красную рамку, чтобы стереть все объекты внутри области.
                </p>
              </div>
            )}

            {/* Transit Move Mode Idle Help */}
            {editorTool === 'move-transit' && !showStationForm && !showRouteForm && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-1.5 text-xs text-amber-950 dark:text-amber-200 leading-relaxed">
                  <div className="font-bold">Перемещение линий и остановок</div>
                  <p>
                    • Захватите и перетащите любую <strong>станцию или остановку</strong> — все
                    связанные маршруты подстроятся автоматически.
                  </p>
                  <p>
                    • Нажмите на <strong>линию транспорта</strong>, чтобы выделить её узлы. Тяните
                    белые точки или кликайте по «+» между ними, чтобы изменить трассу.
                  </p>
                  <p className="text-[11px] opacity-85">
                    Номера маршрутов, расписание, интервалы и список остановок сохраняются полностью.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                    Быстрый выбор линии ({routes.length})
                  </div>
                  <div className="max-h-60 overflow-y-auto murs-scroll divide-y divide-neutral-100 dark:divide-neutral-800 border border-neutral-200/80 dark:border-neutral-700/80 rounded-xl">
                    {routes.slice(0, 40).map((rt) => (
                      <button
                        key={rt.id}
                        type="button"
                        onClick={() => onSelectRouteById(rt.id)}
                        className="w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isMuromorskMetroRoute(rt) ? (
                            <MuromorskMetroBadge size={20} />
                          ) : (
                            <span
                              className="px-1.5 py-0.5 rounded text-[11px] font-bold text-white shrink-0"
                              style={{ backgroundColor: rt.color }}
                            >
                              {rt.number}
                            </span>
                          )}
                          <span className="text-xs text-neutral-900 dark:text-neutral-100 truncate">
                            {rt.name}
                          </span>
                        </div>
                        {hasRouteOverride(rt.id) && (
                          <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                            изм.
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Selected Station Form */}
            {showStationForm && selectedEntity?.type === 'station' && (
              <form onSubmit={handleSubmitStation} className="space-y-3">
                <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-950 dark:text-amber-200 leading-snug">
                  Перетащите маркер этой остановки прямо на карте мышью или введите точные
                  координаты ниже. Все маршруты и расписание сохранятся.
                </div>

                <div>
                  <label
                    htmlFor="ed-st-name"
                    className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                  >
                    Название остановки
                  </label>
                  <input
                    id="ed-st-name"
                    type="text"
                    value={stName}
                    onChange={(e) => setStName(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      X
                    </label>
                    <input
                      type="number"
                      value={stX}
                      onChange={(e) => setStX(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Высота
                    </label>
                    <input
                      type="number"
                      value={stY}
                      onChange={(e) => setStY(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Z
                    </label>
                    <input
                      type="number"
                      value={stZ}
                      onChange={(e) => setStZ(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="flex-1 h-9 px-3 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Сохранить положение</span>
                  </button>
                  {hasStationOverride(selectedEntity.data.id) && (
                    <button
                      type="button"
                      onClick={() => {
                        onResetStationOverride(selectedEntity.data.id);
                        setStatusMsg('Исходное положение остановки восстановлено');
                      }}
                      title="Вернуть исходное положение"
                      className="h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="pt-2 border-t border-neutral-200/80 dark:border-neutral-700/80 space-y-1.5">
                  <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                    Привязанные маршруты (сохраняются)
                  </div>
                  {routes
                    .filter((r) => selectedEntity.data.routeIds.includes(r.id))
                    .slice(0, 8)
                    .map((rt) => (
                      <button
                        key={rt.id}
                        type="button"
                        onClick={() => onSelectRouteById(rt.id)}
                        className="w-full flex items-center justify-between gap-2 text-xs py-1 px-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          {isMuromorskMetroRoute(rt) ? (
                            <MuromorskMetroBadge size={20} />
                          ) : (
                            <span
                              className="px-1.5 py-0.5 rounded text-[11px] font-bold text-white shrink-0"
                              style={{ backgroundColor: rt.color }}
                            >
                              {rt.number}
                            </span>
                          )}
                          <span className="truncate text-neutral-800 dark:text-neutral-200">
                            {rt.name}
                          </span>
                        </span>
                        <span className="text-[11px] text-neutral-400 shrink-0">Трасса →</span>
                      </button>
                    ))}
                </div>
              </form>
            )}

            {/* Selected Transit Route Form */}
            {showRouteForm && selectedEntity?.type === 'route' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  {isMuromorskMetroRoute(selectedEntity.data) ? (
                    <MuromorskMetroBadge size={24} />
                  ) : (
                    <span
                      className="px-2 py-1 rounded-lg text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: selectedEntity.data.color }}
                    >
                      {selectedEntity.data.number}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-neutral-950 dark:text-white truncate">
                      {selectedEntity.data.name}
                    </div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      {getTransportLabelRu(selectedEntity.data.kind)} · {selectedEntity.data.stops.length} ост. · ~{Math.max(1, Math.round(selectedEntity.data.headwaySec / 60))} мин
                    </div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-950 dark:text-amber-200 leading-relaxed space-y-1">
                  <div className="font-semibold">Правка трассировки линии</div>
                  <p>
                    Перетаскивайте белые узлы линии прямо на карте или нажимайте на промежуточные
                    маркеры «+», чтобы добавить изгиб. Все данные маршрута, остановки и движение
                    транспорта сохраняются.
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-300 px-1">
                  <span>Узлов на линии</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {(selectedEntity.data.tracedPath ?? selectedEntity.data.stops).length}
                  </span>
                </div>

                {hasRouteOverride(selectedEntity.data.id) && (
                  <button
                    type="button"
                    onClick={() => {
                      onResetRouteOverride(selectedEntity.data.id);
                      setStatusMsg('Исходная трассировка линии восстановлена');
                    }}
                    className="w-full h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Вернуть исходную трассировку</span>
                  </button>
                )}
              </div>
            )}

            {/* Building Form */}
            {showBuildingForm && (
              <form onSubmit={handleSubmitBuilding} className="space-y-3">
                {/* Snap Options: Road Alignment & Magnetic Building-to-Building Snapping */}
                <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-1.5">
                  {editorTool === 'add-building' && (
                    <div className="text-xs font-semibold text-amber-950 dark:text-amber-200">
                      {(draftBuildingSize.shape ?? 'rect') === 'polygon'
                        ? 'Кликайте по карте, расставляя вершины здания (Enter или клик по 1-й точке — замкнуть)'
                        : 'Рисуйте здания подряд перетаскиванием области (Enter — создать по размерам)'}
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {editorTool === 'add-building' && (
                      <label className="flex items-center gap-2 text-xs font-medium text-amber-950 dark:text-amber-100 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={snapToRoad}
                          onChange={onToggleSnapToRoad}
                          className="h-4 w-4 accent-[#FC3F1D]"
                        />
                        <span>Выравнивать по дорогам</span>
                      </label>
                    )}
                    {onToggleSnapToBuilding && (
                      <label className="flex items-center gap-2 text-xs font-medium text-amber-950 dark:text-amber-100 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={snapToBuilding}
                          onChange={onToggleSnapToBuilding}
                          className="h-4 w-4 accent-[#FC3F1D]"
                        />
                        <span>Привязывать строение к зданию (стык без зазора)</span>
                      </label>
                    )}
                    {onToggleAutoHouseNumbering && (
                      <label className="flex items-center gap-2 text-xs font-medium text-amber-950 dark:text-amber-100 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoHouseNumbering}
                          onChange={onToggleAutoHouseNumbering}
                          className="h-4 w-4 accent-[#FC3F1D]"
                        />
                        <span>Автоматическая нумерация домов по улице</span>
                      </label>
                    )}
                  </div>
                </div>

                {bId && (
                  <div className="p-2.5 rounded-xl bg-neutral-100 dark:bg-[#282B33] text-[11px] text-neutral-600 dark:text-neutral-300 leading-snug">
                    <b>Перетаскивайте здание</b> за корпус свободно по карте (<b>Alt</b> — только
                    выбранный корпус). Тяните углы/вершины, красный ↕ для высоты и синий ↻ для
                    поворота. <b>Shift + ЛКМ</b> — мультивыделение.
                  </div>
                )}

                <div>
                  <label htmlFor="ed-b-name" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Название объекта
                  </label>
                  <input
                    id="ed-b-name"
                    type="text"
                    value={bName}
                    onChange={(e) => setBName(e.target.value)}
                    placeholder="Например: Жилой дом"
                    className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label htmlFor="ed-b-street" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Улица
                    </label>
                    <input
                      id="ed-b-street"
                      type="text"
                      value={bStreet}
                      onChange={(e) => setBStreet(e.target.value)}
                      placeholder="Морской бульвар"
                      className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                    />
                  </div>
                  <div>
                    <label htmlFor="ed-b-house" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Дом
                    </label>
                    <input
                      id="ed-b-house"
                      type="text"
                      value={bHouse}
                      onChange={(e) => setBHouse(e.target.value)}
                      placeholder="15А"
                      className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="ed-b-cat" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Категория
                    </label>
                    <select
                      id="ed-b-cat"
                      value={bCategory}
                      onChange={(e) => setBCategory(e.target.value as BuildingCategory)}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100"
                    >
                      <option value="residential">Жилой дом</option>
                      <option value="commercial">Торговля / БЦ</option>
                      <option value="civic">Администрация</option>
                      <option value="transport">Транспорт</option>
                      <option value="culture">Культура / Спорт</option>
                      <option value="education">Образование</option>
                      <option value="medical">Медицина</option>
                      <option value="industrial">Промышленность</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ed-b-roof" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Тип крыши
                    </label>
                    <select
                      id="ed-b-roof"
                      value={bRoofType}
                      onChange={(e) => setBRoofType(e.target.value as RoofType)}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100"
                    >
                      <option value="flat">Плоская</option>
                      <option value="pitched">Скатная</option>
                      <option value="curved">Кривая / свод</option>
                      <option value="complex">Сложная</option>
                    </select>
                  </div>
                </div>

                {/* Stylish Building Symbol Picker */}
                <div>
                  <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Символ типа здания на карте
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto murs-scroll p-1.5 rounded-lg bg-neutral-100 dark:bg-[#252830]">
                    <button
                      type="button"
                      onClick={() => setBIcon('')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        bIcon === ''
                          ? 'bg-[#FFCC00] text-neutral-950'
                          : 'bg-white dark:bg-[#1B1E24] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/70'
                      }`}
                    >
                      Авто
                    </button>
                    {POI_ICON_CATALOG.map((item) => {
                      const active = bIcon === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setBIcon(item.id)}
                          className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                            active
                              ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950'
                              : 'bg-white dark:bg-[#1B1E24] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/70'
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span>{item.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="ed-b-floors" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Этажей
                    </label>
                    <input
                      id="ed-b-floors"
                      type="number"
                      min={1}
                      value={draftBuildingSize.floors}
                      onChange={(e) =>
                        onChangeDraftBuildingSize({
                          ...draftBuildingSize,
                          floors: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="ed-b-w" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Ширина (м)
                    </label>
                    <input
                      id="ed-b-w"
                      type="number"
                      min={1}
                      step="any"
                      value={draftBuildingSize.width}
                      onChange={(e) =>
                        onChangeDraftBuildingSize({
                          ...draftBuildingSize,
                          width: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="ed-b-d" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Глубина (м)
                    </label>
                    <input
                      id="ed-b-d"
                      type="number"
                      min={1}
                      step="any"
                      value={draftBuildingSize.depth}
                      onChange={(e) =>
                        onChangeDraftBuildingSize({
                          ...draftBuildingSize,
                          depth: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                </div>

                {/* Building Footprint Shape Selector: Rectangular / Parallelogram / Triangular / Circular / Freeform Polygon */}
                <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                      Форма основания здания
                    </span>
                    {bId &&
                      selectedEntity?.type === 'building' &&
                      (draftBuildingSize.shape ?? 'rect') !== 'polygon' &&
                      onConvertWingToFreeform && (
                        <button
                          type="button"
                          onClick={() => {
                            onConvertWingToFreeform(bId, activeWingId ?? undefined);
                            onChangeDraftBuildingSize({
                              ...draftBuildingSize,
                              shape: 'polygon',
                            });
                          }}
                          className="px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold transition-colors whitespace-nowrap"
                        >
                          Лепить форму ⬠
                        </button>
                      )}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { id: 'rect', label: 'Прямоуг.' },
                        { id: 'parallelogram', label: 'Паралл. ▱' },
                        { id: 'triangle', label: 'Треуг. △' },
                        { id: 'circle', label: 'Круг ○' },
                        { id: 'polygon', label: 'Полигон ⬠' },
                      ] as const
                    ).map((opt) => {
                      const active = (draftBuildingSize.shape ?? 'rect') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            const nextCorner = draftBuildingSize.triangleCorner ?? 0;
                            const nextSkew = draftBuildingSize.skewDeg ?? 25;
                            onChangeDraftBuildingSize({
                              ...draftBuildingSize,
                              shape: opt.id,
                              triangleCorner: nextCorner,
                              skewDeg: nextSkew,
                            });
                            if (
                              bId &&
                              selectedEntity?.type === 'building' &&
                              selectedEntity.data.id === bId
                            ) {
                              if (opt.id === 'polygon') {
                                onConvertWingToFreeform?.(bId, activeWingId ?? undefined);
                                return;
                              }
                              const existing = selectedEntity.data;
                              const wings = getBuildingWings(existing);
                              const targetWingId = activeWingId ?? wings[0].id;
                              const nextWings = wings.map((w) => {
                                if (w.id !== targetWingId) return w;
                                const bw = Math.max(1, draftBuildingSize.width);
                                const bd = Math.max(1, draftBuildingSize.depth);
                                const ang = normalizeAngleDeg(draftBuildingSize.angle);
                                return {
                                  ...w,
                                  shapeType:
                                    opt.id === 'circle'
                                      ? ('circular' as const)
                                      : opt.id === 'triangle'
                                      ? ('triangular' as const)
                                      : opt.id === 'parallelogram'
                                      ? ('parallelogram' as const)
                                      : ('rectangular' as const),
                                  skewDeg: opt.id === 'parallelogram' ? nextSkew : undefined,
                                  footprint:
                                    opt.id === 'circle'
                                      ? createCircleFootprint(w.x, w.z, bw, bd, ang, 20)
                                      : opt.id === 'triangle'
                                      ? createTriangleFootprint(w.x, w.z, bw, bd, ang, nextCorner)
                                      : opt.id === 'parallelogram'
                                      ? createParallelogramFootprint(w.x, w.z, bw, bd, ang, nextSkew)
                                      : createRectFootprint(w.x, w.z, bw, bd, ang),
                                };
                              });
                              onSaveBuilding(syncBuildingFromWings(existing, nextWings));
                            }
                          }}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-[#FFCC00] text-neutral-950 border-[#E5B800]'
                              : 'bg-white dark:bg-[#1B1E24] text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Parallelogram Oblique Shear Angle Control */}
                  {(draftBuildingSize.shape ?? 'rect') === 'parallelogram' && (
                    <div className="pt-1.5 space-y-1.5 border-t border-neutral-200/70 dark:border-neutral-700/60">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-neutral-600 dark:text-neutral-300 font-medium">
                          Скос параллелепипеда:
                        </span>
                        <span className="font-mono font-bold text-neutral-900 dark:text-white">
                          {Math.round(draftBuildingSize.skewDeg ?? 25)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-55}
                        max={55}
                        step={1}
                        value={draftBuildingSize.skewDeg ?? 25}
                        onChange={(e) => {
                          const nextSkew = Number(e.target.value);
                          onChangeDraftBuildingSize({
                            ...draftBuildingSize,
                            shape: 'parallelogram',
                            skewDeg: nextSkew,
                          });
                          if (
                            bId &&
                            selectedEntity?.type === 'building' &&
                            selectedEntity.data.id === bId
                          ) {
                            const existing = selectedEntity.data;
                            const wings = getBuildingWings(existing);
                            const targetWingId = activeWingId ?? wings[0].id;
                            const nextWings = wings.map((w) => {
                              if (w.id !== targetWingId) return w;
                              const bw = Math.max(1, draftBuildingSize.width);
                              const bd = Math.max(1, draftBuildingSize.depth);
                              const ang = normalizeAngleDeg(draftBuildingSize.angle);
                              return {
                                ...w,
                                shapeType: 'parallelogram' as const,
                                skewDeg: nextSkew,
                                footprint: createParallelogramFootprint(w.x, w.z, bw, bd, ang, nextSkew),
                              };
                            });
                            onSaveBuilding(syncBuildingFromWings(existing, nextWings));
                          }
                        }}
                        className="w-full accent-[#FC3F1D]"
                      />
                      <div className="grid grid-cols-4 gap-1">
                        {([-30, -15, 15, 30] as const).map((sk) => {
                          const active = Math.round(draftBuildingSize.skewDeg ?? 25) === sk;
                          return (
                            <button
                              key={sk}
                              type="button"
                              onClick={() => {
                                onChangeDraftBuildingSize({
                                  ...draftBuildingSize,
                                  shape: 'parallelogram',
                                  skewDeg: sk,
                                });
                                if (
                                  bId &&
                                  selectedEntity?.type === 'building' &&
                                  selectedEntity.data.id === bId
                                ) {
                                  const existing = selectedEntity.data;
                                  const wings = getBuildingWings(existing);
                                  const targetWingId = activeWingId ?? wings[0].id;
                                  const nextWings = wings.map((w) => {
                                    if (w.id !== targetWingId) return w;
                                    const bw = Math.max(1, draftBuildingSize.width);
                                    const bd = Math.max(1, draftBuildingSize.depth);
                                    const ang = normalizeAngleDeg(draftBuildingSize.angle);
                                    return {
                                      ...w,
                                      shapeType: 'parallelogram' as const,
                                      skewDeg: sk,
                                      footprint: createParallelogramFootprint(w.x, w.z, bw, bd, ang, sk),
                                    };
                                  });
                                  onSaveBuilding(syncBuildingFromWings(existing, nextWings));
                                }
                              }}
                              className={`h-6 rounded-md text-[10px] font-mono font-bold border transition-colors ${
                                active
                                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                                  : 'bg-white dark:bg-[#1B1E24] text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
                              }`}
                            >
                              {sk > 0 ? `+${sk}°` : `${sk}°`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Triangle Corner Selector */}
                  {(draftBuildingSize.shape ?? 'rect') === 'triangle' && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        Прямой угол:
                      </span>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            { c: 0 as const, label: '↖ СЗ' },
                            { c: 1 as const, label: '↗ СВ' },
                            { c: 2 as const, label: '↘ ЮВ' },
                            { c: 3 as const, label: '↙ ЮЗ' },
                          ]
                        ).map((item) => {
                          const active = (draftBuildingSize.triangleCorner ?? 0) === item.c;
                          return (
                            <button
                              key={item.c}
                              type="button"
                              onClick={() => {
                                onChangeDraftBuildingSize({
                                  ...draftBuildingSize,
                                  shape: 'triangle',
                                  triangleCorner: item.c,
                                });
                                if (bId && selectedEntity?.type === 'building' && selectedEntity.data.id === bId) {
                                  const existing = selectedEntity.data;
                                  const wings = getBuildingWings(existing);
                                  const targetWingId = activeWingId ?? wings[0].id;
                                  const nextWings = wings.map((w) => {
                                    if (w.id !== targetWingId) return w;
                                    const bw = Math.max(1, draftBuildingSize.width);
                                    const bd = Math.max(1, draftBuildingSize.depth);
                                    const ang = normalizeAngleDeg(draftBuildingSize.angle);
                                    return {
                                      ...w,
                                      shapeType: 'triangular' as const,
                                      footprint: createTriangleFootprint(w.x, w.z, bw, bd, ang, item.c),
                                    };
                                  });
                                  onSaveBuilding(syncBuildingFromWings(existing, nextWings));
                                }
                              }}
                              className={`px-1.5 py-1 rounded-md text-[10px] font-bold border transition-colors ${
                                active
                                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                                  : 'bg-white dark:bg-[#1B1E24] text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
                              }`}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Freeform Polygon Drawing & Sculpting Controls */}
                  {(draftBuildingSize.shape ?? 'rect') === 'polygon' && (
                    <div className="pt-1.5 space-y-2 border-t border-neutral-200/70 dark:border-neutral-700/60">
                      {editorTool === 'add-building' || isDrawingWing ? (
                        <>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                              Произвольный контур · вершин: {draftBuildingPolygon.length}
                            </span>
                            {draftBuildingPolygon.length >= 3 && (
                              <span className="text-[10px] text-neutral-500">Готово</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={draftBuildingPolygon.length < 3}
                              onClick={() => onFinishBuildingPolygon?.()}
                              className="flex-1 h-7 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[11px] font-bold transition-colors"
                            >
                              Замкнуть (Enter)
                            </button>
                            <button
                              type="button"
                              disabled={draftBuildingPolygon.length === 0}
                              onClick={() => onPopBuildingPolygonPoint?.()}
                              className="h-7 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 disabled:opacity-40 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200"
                            >
                              Назад
                            </button>
                            <button
                              type="button"
                              disabled={draftBuildingPolygon.length === 0}
                              onClick={() => onClearBuildingPolygon?.()}
                              className="h-7 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 disabled:opacity-40 text-[11px] font-semibold text-red-600 dark:text-red-400"
                            >
                              Сброс
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="p-2 rounded-lg bg-emerald-50/90 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 text-[11px] text-emerald-900 dark:text-emerald-200 leading-snug">
                          <b>Режим лепки активен:</b> тяните белые вершины, тяните зелёные{' '}
                          <b>«+»</b> на рёбрах для добавления новых углов, <b>Alt + клик</b> по
                          вершине — удалить её.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Building / Wing Rotation Controls */}
                <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label
                      htmlFor="ed-b-angle"
                      className="font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1.5"
                    >
                      <RotateCw className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                      <span>Поворот здания</span>
                    </label>
                    <span className="font-mono tabular-nums font-bold text-neutral-900 dark:text-white">
                      {Math.round(draftBuildingSize.angle)}°
                    </span>
                  </div>
                  <input
                    id="ed-b-angle"
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={draftBuildingSize.angle}
                    onChange={(e) => {
                      const nextAngle = Number(e.target.value);
                      onChangeDraftBuildingSize({ ...draftBuildingSize, angle: nextAngle });
                      if (bId) {
                        onRotateBuilding(bId, nextAngle, activeWingId ?? undefined);
                      }
                    }}
                    className="w-full accent-sky-600"
                  />
                  <div className="grid grid-cols-4 gap-1">
                    {([-45, -15, 0, 15] as const).map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => {
                          const nextAngle =
                            delta === 0
                              ? 0
                              : normalizeAngleDeg(draftBuildingSize.angle + delta);
                          onChangeDraftBuildingSize({ ...draftBuildingSize, angle: nextAngle });
                          if (bId) {
                            onRotateBuilding(bId, nextAngle, activeWingId ?? undefined);
                          }
                        }}
                        className="h-7 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-mono font-semibold text-neutral-800 dark:text-neutral-200 transition-colors"
                      >
                        {delta === 0 ? '0°' : delta > 0 ? `+${delta}°` : `${delta}°`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Multi-wing (Корпуса) + Merge / Split Complex Building Operations */}
                {bId && selectedEntity?.type === 'building' && (() => {
                  const selB = selectedEntity.data;
                  const wings = getBuildingWings(selB);
                  const curWingId =
                    wings.find((w) => w.id === activeWingId)?.id ?? wings[0]?.id ?? '';
                  const isMergeActive = mergeSourceBuildingId === selB.id;

                  return (
                    <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-neutral-800 dark:text-neutral-100">
                          Корпуса строения ({wings.length})
                        </span>
                        <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                          Единый адрес
                        </span>
                      </div>

                      {/* Wing selector chips */}
                      <div className="flex flex-wrap gap-1">
                        {wings.map((w, idx) => {
                          const isAct = w.id === curWingId;
                          return (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => onSelectWing(w.id)}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                                isAct
                                  ? 'bg-[#FFCC00] text-neutral-950 border-[#E5B800]'
                                  : 'bg-white dark:bg-[#1B1E24] text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                              }`}
                            >
                              {w.label || `Корпус ${idx + 1}`}
                            </button>
                          );
                        })}
                      </div>

                      {/* Add / Draw / Delete wing buttons */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => onAddWingQuick(selB.id)}
                          className="h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Добавить корпус</span>
                        </button>
                        <button
                          type="button"
                          onClick={onToggleDrawWing}
                          className={`h-8 px-2 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                            isDrawingWing
                              ? 'bg-sky-600 text-white border-sky-600'
                              : 'bg-white dark:bg-[#1B1E24] border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200'
                          }`}
                        >
                          <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{isDrawingWing ? 'Отмена рисов.' : 'Нарисовать'}</span>
                        </button>
                      </div>

                      {isDrawingWing && (
                        <div className="p-2 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-[11px] text-sky-900 dark:text-sky-200 leading-snug">
                          {(draftBuildingSize.shape ?? 'rect') === 'polygon'
                            ? `Кликайте вершины нового произвольного корпуса на карте (Enter — присоединить к «${selB.street}, д. ${selB.houseNumber}»).`
                            : `Зажмите ЛКМ на карте и растяните контур нового корпуса — он автоматически присоединится к адресу «${selB.street}, д. ${selB.houseNumber}».`}
                        </div>
                      )}

                      {wings.length >= 2 && (
                        <button
                          type="button"
                          onClick={() => onRemoveWing(selB.id, curWingId)}
                          className="w-full h-8 px-2.5 rounded-lg border border-red-200 dark:border-red-800/80 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Удалить выбранный корпус</span>
                        </button>
                      )}

                      {/* Merge & Split Building Actions */}
                      <div className="pt-2 border-t border-neutral-200/80 dark:border-neutral-700/70 grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => onToggleMergeBuilding(selB.id)}
                          className={`h-8 px-2 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                            isMergeActive
                              ? 'bg-amber-500 text-neutral-950 border-amber-600'
                              : 'bg-white dark:bg-[#1B1E24] border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200'
                          }`}
                        >
                          <Merge className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{isMergeActive ? 'Отмена' : 'Объединить'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onSplitBuilding(selB.id)}
                          className="h-8 px-2 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
                        >
                          <Scissors className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Разделить</span>
                        </button>
                      </div>

                      {isMergeActive && (
                        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-[11px] text-amber-950 dark:text-amber-200 leading-snug">
                          Нажмите на другое здание на карте — оно объединится с текущим в одно
                          строение с общим адресом.
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 h-10 px-4 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{bId ? 'Сохранить' : 'Добавить здание'}</span>
                  </button>
                  {bId && (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteBuilding(bId);
                        setBId(null);
                        setStatusMsg('Здание удалено с карты');
                      }}
                      aria-label="Удалить здание"
                      className="h-10 px-3 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </form>
            )}

            {/* Street / Railway Form */}
            {showStreetForm && (
              <form onSubmit={handleSubmitStreet} className="space-y-3">
                {!sId && (
                  <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-amber-950 dark:text-amber-100 font-semibold">
                      <span>Точек на трассе: {draftStreetPoints.length}</span>
                      {draftStreetPoints.length > 0 && (
                        <button
                          type="button"
                          onClick={onPopStreetPoint}
                          className="text-[#FC3F1D] font-bold whitespace-nowrap"
                        >
                          Шаг назад
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-amber-900/90 dark:text-amber-200/90 leading-snug">
                      Привязывайтесь к узлам и участкам существующих дорог/ЖД под любым углом —
                      перекрёстки создаются автоматически. Высота: <b>Shift + +/−</b>, создать: <b>Enter</b>.
                    </p>
                  </div>
                )}

                <div>
                  <label htmlFor="ed-s-name" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Название дороги / ЖД
                  </label>
                  <input
                    id="ed-s-name"
                    type="text"
                    value={sName}
                    onChange={(e) => setSName(e.target.value)}
                    placeholder={sClass === 'railway' ? 'Например: Главный ход ЖД' : 'Например: Приморское шоссе'}
                    className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label htmlFor="ed-s-class" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Класс дороги
                    </label>
                    <select
                      id="ed-s-class"
                      value={sClass}
                      onChange={(e) => {
                        const nextClass = e.target.value as RoadClass;
                        setSClass(nextClass);
                        if (!sId) {
                          if (nextClass === 'service' || nextClass === 'dirt') setSWidth(6);
                          else if (nextClass === 'highway') setSWidth(26);
                          else if (nextClass === 'avenue') setSWidth(20);
                          else if (nextClass === 'street') setSWidth(14);
                          else if (nextClass === 'lane') setSWidth(9);
                          else if (nextClass === 'pedestrian') setSWidth(5);
                          else if (nextClass === 'railway') setSWidth(7);
                          if (onChangeDraftStreetRoadClass) {
                            onChangeDraftStreetRoadClass(nextClass);
                          }
                        }
                      }}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100"
                    >
                      <option value="highway">Магистраль</option>
                      <option value="avenue">Проспект</option>
                      <option value="embankment">Набережная</option>
                      <option value="street">Улица</option>
                      <option value="lane">Переулок</option>
                      <option value="service">Подъездная / дворовая</option>
                      <option value="dirt">Грунтовая дорога</option>
                      <option value="pedestrian">Пешеходная</option>
                      <option value="railway">ЖД путь / рельсы</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ed-s-w" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Ширина (м)
                    </label>
                    <input
                      id="ed-s-w"
                      type="number"
                      min={1}
                      value={sWidth}
                      onChange={(e) => setSWidth(Math.max(1, Number(e.target.value) || 14))}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                </div>

                {/* One-Way Traffic Control */}
                {sClass !== 'pedestrian' && sClass !== 'railway' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-neutral-600 dark:text-neutral-400">
                        Движение по участку
                      </span>
                      {sOneWay !== 'none' && (
                        <button
                          type="button"
                          onClick={() => {
                            const next: OneWayDirection =
                              sOneWay === 'forward' ? 'reverse' : 'forward';
                            setSOneWay(next);
                            if (!sId && onChangeDraftStreetOneWay) {
                              onChangeDraftStreetOneWay(next);
                            }
                          }}
                          className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          Развернуть
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { id: 'none', label: 'Двустор.', icon: ArrowLeftRight },
                          { id: 'forward', label: 'Вперёд →', icon: ArrowRight },
                          { id: 'reverse', label: '← Обратно', icon: ArrowLeft },
                        ] as const
                      ).map((opt) => {
                        const active = sOneWay === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setSOneWay(opt.id);
                              if (!sId && onChangeDraftStreetOneWay) {
                                onChangeDraftStreetOneWay(opt.id);
                              }
                            }}
                            className={`h-8 px-1.5 rounded-lg text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                              active
                                ? opt.id === 'none'
                                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                                  : 'bg-sky-600 text-white border-sky-600'
                                : 'bg-neutral-50 dark:bg-[#252830] text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Road / Railway Elevation Level Control (Shift + +/-) */}
                {(() => {
                  const relY = Math.round(sElevY - SERVER_GROUND_Y);
                  const levelText =
                    relY > 0
                      ? `Над землёй +${relY} м (эстакада/мост)`
                      : relY < 0
                      ? `Под землёй ${relY} м (тоннель)`
                      : 'Уровень земли (0 м)';
                  const applyElev = (nextY: number) => {
                    const clamped = Math.max(SERVER_GROUND_Y - 30, Math.min(SERVER_GROUND_Y + 60, Math.round(nextY)));
                    setSElevY(clamped);
                    if (!sId && onChangeDraftStreetElevationY) {
                      onChangeDraftStreetElevationY(clamped);
                    }
                  };
                  return (
                    <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-neutral-700 dark:text-neutral-200">
                          Высота уровня
                        </span>
                        <span
                          className={`font-mono tabular-nums font-bold ${
                            relY > 0
                              ? 'text-sky-600 dark:text-sky-400'
                              : relY < 0
                              ? 'text-purple-600 dark:text-purple-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          Y={Math.round(sElevY)}
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                        {levelText}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => applyElev(sElevY - 2)}
                          className="h-8 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-neutral-800 dark:text-neutral-100 flex items-center justify-center gap-1"
                        >
                          <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>2 м</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => applyElev(SERVER_GROUND_Y)}
                          className="h-8 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-100"
                        >
                          Земля (0)
                        </button>
                        <button
                          type="button"
                          onClick={() => applyElev(sElevY + 2)}
                          className="h-8 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-neutral-800 dark:text-neutral-100 flex items-center justify-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>2 м</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sClass === 'pedestrian' || sClass === 'railway' ? false : sSimAllowed}
                    disabled={sClass === 'pedestrian' || sClass === 'railway'}
                    onChange={(e) => setSSimAllowed(e.target.checked)}
                    className="h-4 w-4 accent-[#FC3F1D]"
                  />
                  <span>Разрешить движение на СИМ</span>
                </label>

                {onToggleAutoHouseNumbering && sClass !== 'railway' && (
                  <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoHouseNumbering}
                      onChange={onToggleAutoHouseNumbering}
                      className="h-4 w-4 accent-[#FC3F1D]"
                    />
                    <span>Автообновление нумерации домов вдоль улицы</span>
                  </label>
                )}

                {sId && sClass !== 'railway' && onRenumberStreetBuildings && (
                  <button
                    type="button"
                    onClick={() => onRenumberStreetBuildings(sId)}
                    className="w-full h-9 px-3 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-900/50 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 text-xs font-semibold transition-colors"
                  >
                    Перенумеровать дома вдоль улицы (нечёт / чёт)
                  </button>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 h-10 px-4 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{sId ? 'Сохранить дорогу' : 'Добавить дорогу'}</span>
                  </button>
                  {sId && (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteStreet(sId);
                        setSId(null);
                        setStatusMsg('Дорога удалена');
                      }}
                      aria-label="Удалить дорогу"
                      className="h-10 px-3 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </form>
            )}

            {/* Standalone Map POI Symbol Form */}
            {showPoiForm && (
              <form onSubmit={handleSubmitPoi} className="space-y-3">
                {editorTool === 'add-poi' && (
                  <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-950 dark:text-amber-200 leading-snug">
                    Кликните в любую точку карты (внутри здания или на улице), чтобы поставить
                    символ. Выберите иконку заранее или отредактируйте метку ниже.
                  </div>
                )}

                <div>
                  <label htmlFor="ed-p-name" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Название бизнеса / памятника / метки
                  </label>
                  <input
                    id="ed-p-name"
                    type="text"
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="Например: Кофейня «У моря» или Памятник"
                    className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                  />
                </div>

                <div>
                  <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Символ на карте
                  </div>
                  <div className="grid grid-cols-2 gap-1 max-h-44 overflow-y-auto murs-scroll p-1.5 rounded-xl bg-neutral-100 dark:bg-[#252830]">
                    {POI_ICON_CATALOG.map((item) => {
                      const active = pIcon === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setPIcon(item.id);
                            if (onChangeDraftPoiIcon) onChangeDraftPoiIcon(item.id);
                          }}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 text-left transition-colors ${
                            active
                              ? 'bg-[#FFCC00] text-neutral-950 shadow-sm'
                              : 'bg-white dark:bg-[#1B1E24] text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200/70 dark:hover:bg-neutral-800'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="truncate">{item.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Цвет значка (опционально)
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPColor('')}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold border ${
                        pColor === ''
                          ? 'border-neutral-900 dark:border-white bg-neutral-900 dark:bg-white text-white dark:text-neutral-950'
                          : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300'
                      }`}
                    >
                      По типу
                    </button>
                    {['#DC2626', '#EA580C', '#D97706', '#059669', '#0284C7', '#4F46E5', '#9333EA', '#475569'].map(
                      (col) => (
                        <button
                          key={col}
                          type="button"
                          aria-label={`Цвет ${col}`}
                          onClick={() => setPColor(col)}
                          className={`w-6 h-6 rounded-full border-2 transition-transform ${
                            pColor === col
                              ? 'border-neutral-950 dark:border-white scale-110'
                              : 'border-white dark:border-neutral-800'
                          }`}
                          style={{ backgroundColor: col }}
                        />
                      )
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="ed-p-desc" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Описание (опционально)
                  </label>
                  <input
                    id="ed-p-desc"
                    type="text"
                    value={pDesc}
                    onChange={(e) => setPDesc(e.target.value)}
                    placeholder="Этаж, график работы или заметка"
                    className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      X
                    </label>
                    <input
                      type="number"
                      value={pX}
                      onChange={(e) => setPX(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Z
                    </label>
                    <input
                      type="number"
                      value={pZ}
                      onChange={(e) => setPZ(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 h-10 px-4 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{pId ? 'Сохранить метку' : 'Поставить метку'}</span>
                  </button>
                  {pId && onDeletePoi && (
                    <button
                      type="button"
                      onClick={() => {
                        onDeletePoi(pId);
                        setPId(null);
                        setStatusMsg('Метка удалена с карты');
                      }}
                      aria-label="Удалить метку"
                      className="h-10 px-3 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </form>
            )}

            {/* City / Town / Village / District Text Label Editor */}
            {showPlaceForm && (
              <div className="space-y-3">
                <form onSubmit={handleSubmitPlace} className="space-y-3">
                  <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-950 dark:text-amber-200 leading-snug">
                    {plId
                      ? 'Редактирование подписи на карте. Перетащите надпись на карте для смены позиции или измените текст ниже.'
                      : 'Кликните на карту, чтобы добавить новый город или район, либо выберите существующий из списка ниже.'}
                  </div>

                  <div>
                    <label
                      htmlFor="ed-pl-name"
                      className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                    >
                      Текст надписи (название города / района)
                    </label>
                    <input
                      id="ed-pl-name"
                      type="text"
                      value={plName}
                      onChange={(e) => setPlName(e.target.value)}
                      placeholder="Например: Муроморск или Старый город"
                      className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-semibold text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="ed-pl-sub"
                      className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1"
                    >
                      Подзаголовок / латиница (опционально)
                    </label>
                    <input
                      id="ed-pl-sub"
                      type="text"
                      value={plSubtitle}
                      onChange={(e) => setPlSubtitle(e.target.value)}
                      placeholder="Например: Muromorsk"
                      className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                    />
                  </div>

                  <div>
                    <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                      Уровень подписи
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { id: 'city', label: 'Город' },
                          { id: 'town', label: 'Посёлок / мал. город' },
                          { id: 'village', label: 'Деревня' },
                          { id: 'district', label: 'Район города' },
                        ] as Array<{ id: SettlementTier; label: string }>
                      ).map((opt) => {
                        const active = plTier === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setPlTier(opt.id);
                              onChangeDraftPlaceTier?.(opt.id);
                            }}
                            className={`h-8 px-2 rounded-lg text-[11px] font-semibold transition-colors ${
                              active
                                ? 'bg-[#FFCC00] text-neutral-950 shadow-sm'
                                : 'bg-neutral-100 dark:bg-[#2B2E37] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        X
                      </label>
                      <input
                        type="number"
                        value={plX}
                        onChange={(e) => setPlX(e.target.value)}
                        className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        Z
                      </label>
                      <input
                        type="number"
                        value={plZ}
                        onChange={(e) => setPlZ(e.target.value)}
                        className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                        Приоритет
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={100}
                        value={plPriority}
                        onChange={(e) => setPlPriority(Number(e.target.value) || 75)}
                        className="w-full h-9 px-2 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm font-mono tabular-nums text-neutral-900 dark:text-neutral-100"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="submit"
                      className="flex-1 h-10 px-4 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Save className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{plId ? 'Сохранить текст' : 'Добавить надпись'}</span>
                    </button>
                    {plId && (
                      <button
                        type="button"
                        onClick={() => {
                          setPlId(null);
                          setPlName('');
                          setPlSubtitle('');
                        }}
                        title="Создать новую надпись"
                        className="h-10 px-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-xs font-semibold"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                    {plId && onDeletePlace && (
                      <button
                        type="button"
                        onClick={() => {
                          onDeletePlace(plId);
                          setPlId(null);
                          setPlName('');
                          setPlSubtitle('');
                          setStatusMsg('Надпись удалена с карты');
                        }}
                        aria-label="Удалить надпись"
                        className="h-10 px-3 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </form>

                {/* Quick-pick directory of all cities, settlements & districts for instant editing */}
                <div className="pt-2 border-t border-neutral-200 dark:border-neutral-700/80 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-neutral-700 dark:text-neutral-200">
                      Все города и районы ({filteredPlacesList.length})
                    </span>
                    {onResetDefaultPlaces && (
                      <button
                        type="button"
                        onClick={() => {
                          onResetDefaultPlaces();
                          setStatusMsg('Подписи городов и районов сброшены к исходным');
                        }}
                        className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                      >
                        Сбросить
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {(
                      [
                        { id: 'all', label: 'Все' },
                        { id: 'settlement', label: 'Города' },
                        { id: 'district', label: 'Районы' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPlFilter(tab.id)}
                        className={`flex-1 h-7 rounded-lg text-[11px] font-semibold transition-colors ${
                          plFilter === tab.id
                            ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950'
                            : 'bg-neutral-100 dark:bg-[#252830] text-neutral-600 dark:text-neutral-300'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    value={plQuery}
                    onChange={(e) => setPlQuery(e.target.value)}
                    placeholder="Фильтр по названию..."
                    className="w-full h-8 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#252830] text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                  />

                  <div className="max-h-48 overflow-y-auto murs-scroll divide-y divide-neutral-100 dark:divide-neutral-800 rounded-xl border border-neutral-200/80 dark:border-neutral-700/80 bg-white dark:bg-[#1B1E24]">
                    {filteredPlacesList.map((pl) => {
                      const isActive = plId === pl.id;
                      const badge =
                        pl.tier === 'city'
                          ? 'Город'
                          : pl.tier === 'town'
                          ? 'Пос.'
                          : pl.tier === 'village'
                          ? 'Дер.'
                          : 'Район';
                      return (
                        <button
                          key={pl.id}
                          type="button"
                          onClick={() => {
                            setPlId(pl.id);
                            setPlName(pl.name);
                            setPlSubtitle(pl.subtitle ?? '');
                            setPlTier(pl.tier);
                            setPlPriority(pl.priority);
                            setPlX(String(Math.round(pl.x)));
                            setPlZ(String(Math.round(pl.z)));
                            onSelectPlace?.(pl);
                          }}
                          className={`w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left text-xs transition-colors ${
                            isActive
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-neutral-950 dark:text-white font-bold'
                              : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/70 text-neutral-800 dark:text-neutral-200'
                          }`}
                        >
                          <span className="truncate">{pl.name}</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-[#2B2E37] text-neutral-500 dark:text-neutral-400 shrink-0">
                            {badge}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Unified Territory Polygon Form (Parks / Water / Plazas) */}
            {showLandForm && (
              <form onSubmit={handleSubmitLand} className="space-y-3">
                {/* Instant Territory Type Selector (syncs live canvas draft color!) */}
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      {
                        id: 'park',
                        label: 'Парк',
                        icon: Trees,
                        activeClass: 'bg-emerald-600 text-white border-emerald-600',
                      },
                      {
                        id: 'water',
                        label: 'Водоём',
                        icon: Waves,
                        activeClass: 'bg-sky-600 text-white border-sky-600',
                      },
                      {
                        id: 'square',
                        label: 'Площадь',
                        icon: Layers2,
                        activeClass: 'bg-amber-600 text-white border-amber-600',
                      },
                    ] as const
                  ).map((opt) => {
                    const Icon = opt.icon;
                    const isActive = lKind === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setLKind(opt.id);
                          onChangeDraftLandKind?.(opt.id);
                        }}
                        className={`h-9 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                          isActive
                            ? opt.activeClass
                            : 'bg-neutral-100 dark:bg-[#282B33] border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200/70 dark:hover:bg-[#323641]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>

                {onToggleSnapToLand && (
                  <div className="p-2.5 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 space-y-1">
                    <label className="flex items-center gap-2 text-xs font-medium text-emerald-950 dark:text-emerald-100 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={snapToLand}
                        onChange={onToggleSnapToLand}
                        className="h-4 w-4 accent-emerald-600"
                      />
                      <span>Привязывать к узлам других территорий</span>
                    </label>
                    <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 leading-snug pl-6">
                      Соседние территории одного типа соединяются бесшовно без внутренней границы.
                    </p>
                  </div>
                )}

                {!lId && (
                  <div className="p-2.5 rounded-xl bg-neutral-100 dark:bg-[#282B33] text-xs text-neutral-600 dark:text-neutral-300 flex items-center justify-between gap-2">
                    <span>Кликайте по карте · вершин: {draftLandPoints.length}</span>
                    {draftLandPoints.length > 0 && (
                      <button
                        type="button"
                        onClick={onPopLandPoint}
                        className="text-[#FC3F1D] font-semibold whitespace-nowrap"
                      >
                        Шаг назад
                      </button>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor="ed-l-name" className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Название территории
                  </label>
                  <input
                    id="ed-l-name"
                    type="text"
                    value={lName}
                    onChange={(e) => setLName(e.target.value)}
                    placeholder={
                      lKind === 'water'
                        ? 'Например: Река Мур'
                        : lKind === 'square'
                        ? 'Например: Казанская площадь'
                        : 'Например: Приморский парк'
                    }
                    className="w-full h-9 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 h-10 px-4 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{lId ? 'Сохранить контур' : 'Завершить и сохранить'}</span>
                  </button>
                  {lId && (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteLandFeature(lId);
                        setLId(null);
                        setStatusMsg('Объект удалён');
                      }}
                      aria-label="Удалить объект"
                      className="h-10 px-3 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </form>
            )}

            {/* Idle Select Guide */}
            {editorTool === 'select' &&
              !isMultiSelectActive &&
              !multiSelectMode &&
              !showBuildingForm &&
              !showStreetForm &&
              !showLandForm &&
              !showPoiForm &&
              !showPlaceForm &&
              !showStationForm &&
              !showRouteForm && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 space-y-2 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    <div className="font-bold text-neutral-900 dark:text-white">
                      Графическое редактирование карты
                    </div>
                    <p>
                      Нажмите на любой объект на карте — появятся маркеры вершин и размеров для
                      прямой правки мышью.
                    </p>
                    <p>
                      Удерживайте <strong>Shift + ЛКМ</strong> (или <strong>Shift + рамка</strong>),
                      чтобы выделить сразу несколько зданий, дорог, территорий, меток или подписей и
                      изменить их свойства разом.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70">
                      <div className="text-neutral-500 dark:text-neutral-400">Здания и дороги</div>
                      <div className="font-mono tabular-nums font-bold text-neutral-900 dark:text-white mt-0.5">
                        {userBuildingsCount} зд. · {userStreetsCount} ул.
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70">
                      <div className="text-neutral-500 dark:text-neutral-400">Парки / Вода</div>
                      <div className="font-mono tabular-nums font-bold text-neutral-900 dark:text-white mt-0.5">
                        {userLandCount} конт.
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 col-span-2">
                      <div className="text-neutral-500 dark:text-neutral-400">Правки транспорта</div>
                      <div className="font-mono tabular-nums font-bold text-neutral-900 dark:text-white mt-0.5">
                        {movedStationsCount} ост. · {movedRoutesCount} линий
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer Export / Import / Reset */}
          {editorTool !== 'synthesis' && (
            <div className="px-4 py-2.5 border-t border-neutral-200/80 dark:border-neutral-700/80 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onExportJson}
                  className="h-8 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2A2D36] hover:bg-neutral-200 dark:hover:bg-[#353945] text-xs font-medium text-neutral-800 dark:text-neutral-200 inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Экспорт</span>
                </button>
                <label className="h-8 px-2.5 rounded-lg bg-neutral-100 dark:bg-[#2A2D36] hover:bg-neutral-200 dark:hover:bg-[#353945] text-xs font-medium text-neutral-800 dark:text-neutral-200 inline-flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Импорт</span>
                  <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
                </label>
              </div>

              <button
                type="button"
                onClick={onResetAllEdits}
                className="h-8 px-2.5 rounded-lg text-xs font-medium text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400 inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Сбросить</span>
              </button>
            </div>
          )}
        </div>

        {/* Desktop Drawer collapse toggle */}
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          aria-label={drawerOpen ? 'Свернуть инспектор' : 'Развернуть инспектор'}
          className="hidden sm:flex self-start mt-4 -ml-px h-10 w-6 rounded-r-xl bg-white/95 dark:bg-[#1E2027]/95 border border-l-0 border-neutral-200/90 dark:border-neutral-700/80 shadow-md items-center justify-center text-neutral-600 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white transition-colors"
        >
          {drawerOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </aside>
    </>
  );
};

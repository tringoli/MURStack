import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Globe,
  Navigation,
  Pencil,
  TrainFront,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BuildingCategory,
  MtrRoute,
  MtrStation,
  RoadClass,
  RoofType,
  RouteEndpoint,
  SelectedEntity,
} from '../types/map';
import {
  dist2D,
  formatDistanceRu,
  formatDurationRu,
  getTransportLabelRu,
  WALK_SPEED_BLOCKS_PER_SEC,
} from '../utils/routing';
import { SERVER_GROUND_Y } from '../utils/geometry';
import { TransitStopBadge } from './TransitStopBadge';
import { MuromorskMetroBadge } from './MuromorskMetroBadge';
import { isMuromorskMetroRoute } from '../utils/mursTransitBrand';
import { buildStationCombinedModesMap } from '../utils/transitStopIcons';
import { POI_ICON_MAP, resolveBuildingIconKind } from '../utils/poiIcons';

interface PlaceCardProps {
  entity: SelectedEntity;
  stations: MtrStation[];
  routes: MtrRoute[];
  onClose: () => void;
  onRouteTo: (ep: RouteEndpoint) => void;
  onRouteFrom: (ep: RouteEndpoint) => void;
  onOpenBlueMap: (x: number, z: number) => void;
  onEditEntity: (entity: SelectedEntity) => void;
  onDeleteEntity?: (entity: SelectedEntity) => void;
  onSelectStation: (station: MtrStation) => void;
}

const CATEGORY_LABELS: Record<BuildingCategory, string> = {
  residential: 'Жилой дом',
  civic: 'Администрация',
  commercial: 'Торговля и офисы',
  transport: 'Транспортный объект',
  medical: 'Медицина',
  culture: 'Культура и спорт',
  education: 'Образование',
  industrial: 'Промышленность',
};

const ROAD_LABELS: Record<RoadClass, string> = {
  highway: 'Скоростная магистраль',
  avenue: 'Проспект',
  street: 'Улица',
  lane: 'Переулок',
  service: 'Подъездная дорога',
  dirt: 'Грунтовая дорога',
  embankment: 'Набережная',
  pedestrian: 'Пешеходная зона',
  railway: 'Железная дорога',
};

const ROOF_LABELS: Record<RoofType, string> = {
  flat: 'Плоская крыша',
  pitched: 'Скатная крыша',
  curved: 'Кривая / сводчатая крыша',
  complex: 'Сложная крыша',
};

export const PlaceCard: React.FC<PlaceCardProps> = ({
  entity,
  stations,
  routes,
  onClose,
  onRouteTo,
  onRouteFrom,
  onOpenBlueMap,
  onEditEntity,
  onDeleteEntity,
  onSelectStation,
}) => {
  const [copied, setCopied] = useState(false);
  const combinedModesMap = useMemo(() => buildStationCombinedModesMap(stations), [stations]);

  let title = '';
  let subtitle = '';
  let addressLine = '';
  let coords = { x: 0, y: SERVER_GROUND_Y, z: 0 };
  let description: string | undefined;
  let canEdit = false;

  if (entity.type === 'building') {
    const b = entity.data;
    const baseY = Math.round(b.baseY ?? SERVER_GROUND_Y);
    title = b.name;
    subtitle = `${CATEGORY_LABELS[b.category]} · ${b.district}`;
    addressLine = `${b.street}, д. ${b.houseNumber}`;
    coords = { x: Math.round(b.x), y: baseY, z: Math.round(b.z) };
    description = b.description;
    canEdit = true;
  } else if (entity.type === 'poi') {
    const poi = entity.data;
    const meta = POI_ICON_MAP[poi.icon] ?? POI_ICON_MAP.star;
    title = poi.name;
    subtitle = `${meta.label} · Метка на карте`;
    addressLine = `Координаты: ${Math.round(poi.x)}, ${Math.round(poi.z)}`;
    coords = {
      x: Math.round(poi.x),
      y: Math.round(poi.y ?? SERVER_GROUND_Y),
      z: Math.round(poi.z),
    };
    description = poi.description;
    canEdit = true;
  } else if (entity.type === 'station') {
    const s = entity.data;
    title = s.name;
    const kindsText = s.kinds.map(getTransportLabelRu).join(', ');
    subtitle = `${kindsText} · ${s.district || 'Муроморск'}`;
    addressLine = s.englishName ? s.englishName : 'Остановка общественного транспорта';
    coords = { x: Math.round(s.x), y: Math.round(s.y), z: Math.round(s.z) };
    canEdit = true;
  } else if (entity.type === 'street') {
    const st = entity.data;
    const mid = st.points[Math.floor(st.points.length / 2)] || { x: 10550, z: -620 };
    const elevY = Math.round(st.elevationY ?? SERVER_GROUND_Y);
    title = st.name;
    subtitle = `${ROAD_LABELS[st.roadClass]} · ${st.district}`;
    const oneWaySuffix =
      st.oneWay === 'forward'
        ? ' · Одностороннее →'
        : st.oneWay === 'reverse'
        ? ' · Одностороннее ←'
        : '';
    addressLine =
      st.roadClass === 'railway'
        ? `Ширина пути ${st.width} м · Рельсовый коридор`
        : `Ширина ${st.width} м${oneWaySuffix} · ${
            st.simAllowed ? 'Доступно для пеших и СИМ' : 'Только пешеходное движение'
          }`;
    coords = { x: Math.round(mid.x), y: elevY, z: Math.round(mid.z) };
    canEdit = true;
  } else if (entity.type === 'land') {
    const feat = entity.data;
    const cx =
      feat.polygon.length > 0
        ? feat.polygon.reduce((s, p) => s + p.x, 0) / feat.polygon.length
        : 10550;
    const cz =
      feat.polygon.length > 0
        ? feat.polygon.reduce((s, p) => s + p.z, 0) / feat.polygon.length
        : -620;
    title = feat.name;
    subtitle =
      feat.kind === 'water'
        ? 'Водоём · Муроморск'
        : feat.kind === 'park'
        ? 'Парк / сквер · Муроморск'
        : 'Площадь · Муроморск';
    addressLine = `Контур из ${feat.polygon.length} вершин`;
    coords = { x: Math.round(cx), y: SERVER_GROUND_Y, z: Math.round(cz) };
    canEdit = true;
  } else if (entity.type === 'route') {
    const rt = entity.data;
    const midStop = rt.stops[Math.floor(rt.stops.length / 2)] || { x: 10550, y: SERVER_GROUND_Y, z: -620 };
    title = rt.name;
    subtitle = `${getTransportLabelRu(rt.kind)} №${rt.number}`;
    addressLine = `Остановок: ${rt.stops.length} · Интервал ~${Math.max(1, Math.round(rt.headwaySec / 60))} мин`;
    coords = { x: Math.round(midStop.x), y: Math.round(midStop.y), z: Math.round(midStop.z) };
    canEdit = true;
  } else if (entity.type === 'place') {
    const pl = entity.data;
    const tierRu =
      pl.tier === 'city'
        ? 'Город'
        : pl.tier === 'town'
        ? 'Посёлок / город'
        : pl.tier === 'village'
        ? 'Деревня / посёлок'
        : 'Район города';
    title = pl.name;
    subtitle = pl.subtitle ? `${tierRu} · ${pl.subtitle}` : tierRu;
    addressLine = `Подпись на карте · Приоритет ${pl.priority}`;
    coords = { x: Math.round(pl.x), y: SERVER_GROUND_Y, z: Math.round(pl.z) };
    canEdit = true;
  } else {
    title = entity.label || 'Точка на карте';
    subtitle = 'Муроморск';
    addressLine = `Координаты: ${entity.x}, ${entity.z}`;
    coords = { x: Math.round(entity.x), y: SERVER_GROUND_Y, z: Math.round(entity.z) };
  }

  const endpoint: RouteEndpoint = {
    label: title,
    sublabel: addressLine,
    x: coords.x,
    z: coords.z,
    stationId: entity.type === 'station' ? entity.data.id : undefined,
    buildingId: entity.type === 'building' ? entity.data.id : undefined,
  };

  const nearbyStations = stations
    .filter((s) => (entity.type === 'station' ? s.id !== entity.data.id : true))
    .map((s) => ({ station: s, dist: dist2D(coords, s) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 4);

  const servingRoutes =
    entity.type === 'station'
      ? routes.filter((r) => entity.data.routeIds.includes(r.id)).slice(0, 8)
      : [];

  const handleCopyCoords = () => {
    const text = `${coords.x}, ${coords.z}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const canDelete =
    entity.type === 'building' ||
    entity.type === 'street' ||
    entity.type === 'land' ||
    entity.type === 'poi' ||
    entity.type === 'place';

  const buildingSymbolMeta =
    entity.type === 'building'
      ? POI_ICON_MAP[resolveBuildingIconKind(entity.data)]
      : entity.type === 'poi'
      ? POI_ICON_MAP[entity.data.icon] ?? POI_ICON_MAP.star
      : null;
  const symbolAccentColor =
    entity.type === 'poi'
      ? entity.data.color || buildingSymbolMeta?.color || '#FC3F1D'
      : buildingSymbolMeta?.color;

  return (
    <div className="px-4 py-3 space-y-4 murs-anim-tab">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {entity.type === 'station' && (
            <TransitStopBadge
              station={entity.data}
              nearbyKinds={combinedModesMap.get(entity.data.id)}
              size={28}
              className="mt-0.5"
            />
          )}
          {entity.type === 'route' && isMuromorskMetroRoute(entity.data) && (
            <MuromorskMetroBadge size={26} className="mt-0.5" />
          )}
          {buildingSymbolMeta && (
            <span
              className="mt-0.5 px-2 py-0.5 rounded-lg text-[11px] font-bold text-white shrink-0"
              style={{ backgroundColor: symbolAccentColor }}
            >
              {buildingSymbolMeta.shortLabel}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-bold text-neutral-950 dark:text-white leading-snug">
              {title}
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть карточку объекта"
          className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Address & Specs */}
      <div className="space-y-1.5 text-sm">
        <div className="text-neutral-800 dark:text-neutral-200 font-medium">{addressLine}</div>
        {entity.type === 'building' && (
          <div className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
            <div>
              <span>{entity.data.floors} эт.</span>
              <span aria-hidden="true"> · </span>
              <span>Высота {entity.data.height} м</span>
              {entity.data.wings && entity.data.wings.length > 1 && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="font-semibold text-neutral-700 dark:text-neutral-200">
                    {entity.data.wings.length} корп.
                  </span>
                </>
              )}
            </div>
            <div>
              <span>{ROOF_LABELS[entity.data.roofType ?? 'flat']}</span>
              {entity.data.measuredWidth && entity.data.measuredDepth && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {Math.round(entity.data.measuredWidth)}×{Math.round(entity.data.measuredDepth)} м
                  </span>
                </>
              )}
              {entity.data.isUserEdited && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    Изменено
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        {description && (
          <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed pt-1">
            {description}
          </p>
        )}
      </div>

      {/* Coordinates Copy Row */}
      <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-xl bg-neutral-100/90 dark:bg-[#272A32]">
        <div className="text-xs font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
          {coords.x}, {coords.z}
        </div>
        <button
          type="button"
          onClick={handleCopyCoords}
          className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:text-neutral-950 dark:hover:text-white whitespace-nowrap shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Скопировано</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Копировать</span>
            </>
          )}
        </button>
      </div>

      {/* Primary Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onRouteTo(endpoint)}
          className="h-10 px-3 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Маршрут сюда</span>
        </button>
        <button
          type="button"
          onClick={() => onRouteFrom(endpoint)}
          className="h-10 px-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-[#2A2D36] dark:hover:bg-[#353945] text-neutral-900 dark:text-neutral-100 text-xs font-semibold flex items-center justify-center transition-colors whitespace-nowrap"
        >
          Отсюда (А)
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenBlueMap(coords.x, coords.z)}
          className="flex-1 h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <Globe className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Спутник</span>
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={() => onEditEntity(entity)}
            className="h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            <span>В редактор</span>
          </button>
        )}
        {canDelete && onDeleteEntity && (
          <button
            type="button"
            onClick={() => onDeleteEntity(entity)}
            aria-label="Удалить объект"
            title="Удалить с карты"
            className="h-9 px-2.5 rounded-xl border border-red-200 dark:border-red-800/80 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Serving Routes for Stations */}
      {servingRoutes.length > 0 && (
        <div className="pt-2 border-t border-neutral-200/80 dark:border-neutral-700/80">
          <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
            Маршруты через остановку
          </div>
          <div className="space-y-1.5">
            {servingRoutes.map((rt) => (
              <div
                key={rt.id}
                className="flex items-center justify-between gap-2 text-xs py-1"
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
                  <span className="text-neutral-800 dark:text-neutral-200 truncate">
                    {rt.name}
                  </span>
                </div>
                <span className="font-mono tabular-nums text-neutral-500 dark:text-neutral-400 shrink-0">
                  ~{Math.round(rt.headwaySec / 60)} мин
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Nearby Stations */}
      {nearbyStations.length > 0 && (
        <div className="pt-2 border-t border-neutral-200/80 dark:border-neutral-700/80">
          <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2">
            Ближайшие остановки и метро
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {nearbyStations.map(({ station, dist }) => {
              const walkSec = Math.round(dist / WALK_SPEED_BLOCKS_PER_SEC);
              return (
                <button
                  key={station.id}
                  type="button"
                  onClick={() => onSelectStation(station)}
                  className="w-full py-2 flex items-center justify-between gap-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg px-1.5 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <TransitStopBadge
                      station={station}
                      nearbyKinds={combinedModesMap.get(station.id)}
                      size={20}
                    />
                    <span className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                      {station.name}
                    </span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-neutral-500 dark:text-neutral-400 shrink-0 flex items-center gap-1">
                    <TrainFront className="w-3 h-3" aria-hidden="true" />
                    {formatDistanceRu(dist)} · {formatDurationRu(walkSec)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

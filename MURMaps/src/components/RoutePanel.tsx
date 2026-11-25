import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Bike,
  Car,
  ChevronDown,
  ChevronUp,
  Clock,
  Footprints,
  MapPin,
  TrainFront,
  X,
} from 'lucide-react';
import type {
  Building3D,
  ComputedRoute,
  MapPoi,
  MtrStation,
  PoiIconKind,
  RouteEndpoint,
  SimVehicleType,
  StreetSegment,
  TravelMode,
} from '../types/map';
import {
  formatDistanceRu,
  formatDurationRu,
  getTransportLabelRu,
  MURS_SPEED_CONSTANTS,
  SIM_PROFILES,
} from '../utils/routing';
import { formatLocalTimeRu } from '../utils/scheduleSync';
import { searchMapEntities } from '../utils/smartSearch';
import { TransitStopBadge } from './TransitStopBadge';
import { MuromorskMetroBadge } from './MuromorskMetroBadge';
import { buildStationCombinedModesMap } from '../utils/transitStopIcons';
import { POI_ICON_MAP } from '../utils/poiIcons';
import { isMuromorskCoordinate, isMuromorskMetroStation } from '../utils/mursTransitBrand';

interface RoutePanelProps {
  pointA: RouteEndpoint | null;
  pointB: RouteEndpoint | null;
  travelMode: TravelMode;
  simVehicle: SimVehicleType;
  pickMode: 'A' | 'B' | null;
  transitRoutes: ComputedRoute[];
  autoRoute: ComputedRoute | null;
  walkRoute: ComputedRoute | null;
  simRoute: ComputedRoute | null;
  selectedTransitIdx: number;
  stations: MtrStation[];
  buildings: Building3D[];
  streets: StreetSegment[];
  pois?: MapPoi[];
  compactMobile?: boolean;
  onRequestExpandMobile?: () => void;
  onChangePointA: (pt: RouteEndpoint | null) => void;
  onChangePointB: (pt: RouteEndpoint | null) => void;
  onSwapPoints: () => void;
  onChangeTravelMode: (mode: TravelMode) => void;
  onChangeSimVehicle: (veh: SimVehicleType) => void;
  onSelectTransitIdx: (idx: number) => void;
  onStartPickOnMap: (which: 'A' | 'B' | null) => void;
  departureTimeMode: 'now' | 'custom';
  customDepartureTime: string;
  effectiveDepartureMs: number;
  onChangeDepartureTimeMode: (mode: 'now' | 'custom') => void;
  onChangeCustomDepartureTime: (hhmm: string) => void;
}

interface SearchOption {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  z: number;
  stationId?: string;
  buildingId?: string;
  badgeType?: 'muromorsk-metro' | 'metro' | 'icon';
  badgeColor?: string;
  iconKind?: PoiIconKind;
}

export const RoutePanel: React.FC<RoutePanelProps> = ({
  pointA,
  pointB,
  travelMode,
  simVehicle,
  pickMode,
  transitRoutes,
  autoRoute,
  walkRoute,
  simRoute,
  selectedTransitIdx,
  stations,
  buildings,
  streets,
  pois = [],
  compactMobile = false,
  onRequestExpandMobile,
  onChangePointA,
  onChangePointB,
  onSwapPoints,
  onChangeTravelMode,
  onChangeSimVehicle,
  onSelectTransitIdx,
  onStartPickOnMap,
  departureTimeMode,
  customDepartureTime,
  effectiveDepartureMs,
  onChangeDepartureTimeMode,
  onChangeCustomDepartureTime,
}) => {
  const [queryA, setQueryA] = useState(pointA?.label ?? '');
  const [queryB, setQueryB] = useState(pointB?.label ?? '');
  const [focusedField, setFocusedField] = useState<'A' | 'B' | null>(null);
  const [expandedStops, setExpandedStops] = useState<Record<number, boolean>>({});
  const [showSpeeds, setShowSpeeds] = useState(false);

  // Sync external changes (e.g. from map click / PlaceCard / swap)
  React.useEffect(() => {
    setQueryA(pointA?.label ?? '');
  }, [pointA]);

  React.useEffect(() => {
    setQueryB(pointB?.label ?? '');
  }, [pointB]);

  const stationById = useMemo(() => {
    const map = new Map<string, MtrStation>();
    for (const s of stations) map.set(s.id, s);
    return map;
  }, [stations]);

  const combinedModesMap = useMemo(() => buildStationCombinedModesMap(stations), [stations]);

  const allOptions = useMemo<SearchOption[]>(() => {
    const list: SearchOption[] = [];
    for (const s of stations) {
      const isMetro = s.kinds.includes('metro');
      const kindText = isMetro
        ? 'Метро'
        : s.kinds.includes('tram')
        ? 'Трамвай'
        : s.kinds.includes('rail')
        ? 'ЖД станция'
        : 'Остановка';
      list.push({
        id: `st-${s.id}`,
        label: s.name,
        sublabel: `${kindText} · ${s.district || 'Муроморск'}`,
        x: s.x,
        z: s.z,
        stationId: s.id,
        badgeType: isMetro ? (isMuromorskMetroStation(s) ? 'muromorsk-metro' : 'metro') : undefined,
        badgeColor: s.color,
      });
    }
    for (const poi of pois) {
      const meta = POI_ICON_MAP[poi.icon] ?? POI_ICON_MAP.star;
      list.push({
        id: `poi-${poi.id}`,
        label: poi.name,
        sublabel: `${meta.shortLabel} · Метка на карте`,
        x: poi.x,
        z: poi.z,
        badgeType: 'icon',
        badgeColor: poi.color || meta.color,
        iconKind: poi.icon,
      });
    }
    for (const b of buildings) {
      list.push({
        id: `b-${b.id}`,
        label: b.name,
        sublabel: `${b.street}, д. ${b.houseNumber}`,
        x: b.x,
        z: b.z,
        buildingId: b.id,
      });
    }
    for (const st of streets) {
      const mid = st.points[Math.floor(st.points.length / 2)];
      if (!mid) continue;
      list.push({
        id: `str-${st.id}`,
        label: st.name,
        sublabel: `Улица · ${st.district}`,
        x: mid.x,
        z: mid.z,
      });
    }
    return list;
  }, [stations, buildings, streets, pois]);

  const filterOptions = (q: string): SearchOption[] => {
    const trimmed = q.trim();
    if (!trimmed) {
      return allOptions.slice(0, 7);
    }
    const smartHits = searchMapEntities(
      trimmed,
      { stations, buildings, streets, pois },
      8
    );
    return smartHits.map((hit) => ({
      id: hit.id,
      label: hit.title,
      sublabel: hit.subtitle,
      x: hit.x,
      z: hit.z,
      stationId: hit.entity.type === 'station' ? hit.entity.data.id : undefined,
      buildingId: hit.entity.type === 'building' ? hit.entity.data.id : undefined,
      badgeType: hit.badgeType,
      badgeColor: hit.badgeColor,
      iconKind: hit.iconKind,
    }));
  };

  const activeSuggestions =
    focusedField === 'A'
      ? filterOptions(queryA)
      : focusedField === 'B'
      ? filterOptions(queryB)
      : [];

  const handleSelectOption = (which: 'A' | 'B', opt: SearchOption) => {
    const ep: RouteEndpoint = {
      label: opt.label,
      sublabel: opt.sublabel,
      x: opt.x,
      z: opt.z,
      stationId: opt.stationId,
      buildingId: opt.buildingId,
    };
    if (which === 'A') {
      onChangePointA(ep);
      setQueryA(opt.label);
    } else {
      onChangePointB(ep);
      setQueryB(opt.label);
    }
    setFocusedField(null);
  };

  const activeRoute: ComputedRoute | null =
    travelMode === 'transit'
      ? transitRoutes[selectedTransitIdx] ?? transitRoutes[0] ?? null
      : travelMode === 'auto'
      ? autoRoute
      : travelMode === 'walk'
      ? walkRoute
      : simRoute;

  const transitBestSec = transitRoutes[0]?.totalDurationSec;
  const autoSec = autoRoute?.totalDurationSec;
  const walkSec = walkRoute?.totalDurationSec;
  const simSec = simRoute?.totalDurationSec;

  const hasBothEndpoints = Boolean(pointA && pointB);
  const hideExtrasForCompactMobile = compactMobile && !hasBothEndpoints;

  return (
    <div className="flex flex-col h-full murs-anim-tab">
      {/* Point A / B inputs */}
      <div className={`px-4 ${compactMobile ? 'pt-2 pb-2.5' : 'pt-3 pb-3'} border-b border-neutral-200/80 dark:border-neutral-700/80`}>
        <div className="flex items-center gap-2">
          <div className="flex-1 space-y-2">
            {/* Point A */}
            <div className="relative flex items-center">
              <span
                className="w-5 h-5 rounded-full bg-[#FC3F1D] text-white text-[11px] font-bold flex items-center justify-center shrink-0 mr-2"
                aria-hidden="true"
              >
                А
              </span>
              <input
                type="text"
                aria-label="Откуда (точка А)"
                placeholder="Откуда: остановка, адрес, вокзал…"
                value={queryA}
                onFocus={() => setFocusedField('A')}
                onChange={(e) => {
                  setQueryA(e.target.value);
                  if (!e.target.value.trim()) onChangePointA(null);
                }}
                className="w-full h-9 pl-2.5 pr-14 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
              />
              <div className="absolute right-1.5 flex items-center gap-0.5">
                {queryA && (
                  <button
                    type="button"
                    aria-label="Очистить точку А"
                    onClick={() => {
                      setQueryA('');
                      onChangePointA(null);
                    }}
                    className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Выбрать точку А на карте"
                  title="Указать точку А на карте"
                  onClick={() => onStartPickOnMap(pickMode === 'A' ? null : 'A')}
                  className={`p-1 rounded transition-colors ${
                    pickMode === 'A'
                      ? 'bg-[#FC3F1D] text-white'
                      : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Point B */}
            <div className="relative flex items-center">
              <span
                className="w-5 h-5 rounded-full bg-[#2563EB] text-white text-[11px] font-bold flex items-center justify-center shrink-0 mr-2"
                aria-hidden="true"
              >
                Б
              </span>
              <input
                type="text"
                aria-label="Куда (точка Б)"
                placeholder="Куда: остановка, адрес, библиотека…"
                value={queryB}
                onFocus={() => setFocusedField('B')}
                onChange={(e) => {
                  setQueryB(e.target.value);
                  if (!e.target.value.trim()) onChangePointB(null);
                }}
                className="w-full h-9 pl-2.5 pr-14 rounded-lg bg-neutral-100 dark:bg-[#2B2E37] text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
              />
              <div className="absolute right-1.5 flex items-center gap-0.5">
                {queryB && (
                  <button
                    type="button"
                    aria-label="Очистить точку Б"
                    onClick={() => {
                      setQueryB('');
                      onChangePointB(null);
                    }}
                    className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Выбрать точку Б на карте"
                  title="Указать точку Б на карте"
                  onClick={() => onStartPickOnMap(pickMode === 'B' ? null : 'B')}
                  className={`p-1 rounded transition-colors ${
                    pickMode === 'B'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onSwapPoints}
            aria-label="Поменять точки А и Б местами"
            title="Поменять местами"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/60 transition-all shrink-0 group"
          >
            <ArrowUpDown className="w-4 h-4 transition-transform duration-200 group-hover:rotate-180" />
          </button>
        </div>

        {pickMode ? (
          <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-[#FFCC00]/25 text-xs font-medium text-neutral-900 dark:text-amber-200 flex items-center justify-between murs-anim-pop">
            <span>
              Кликните по карте: выберите точку {pickMode === 'A' ? 'А (старт)' : 'Б (финиш)'}
            </span>
            <button
              type="button"
              onClick={() => onStartPickOnMap(null)}
              className="underline font-semibold ml-2"
            >
              Отмена
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onStartPickOnMap('A')}
              className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white inline-flex items-center gap-1 transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-[#FC3F1D]" aria-hidden="true" />
              <span>Выбрать А и Б на карте</span>
            </button>
            {!compactMobile && (
              <button
                type="button"
                onClick={() => setShowSpeeds((s) => !s)}
                aria-expanded={showSpeeds}
                className="text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
              >
                {showSpeeds ? 'Скрыть скорости' : 'Скорости'}
              </button>
            )}
          </div>
        )}

        {!compactMobile && showSpeeds && (
          <div className="mt-2 p-2.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70 murs-anim-pop">
            <div className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5">
              Расчётные скорости движения
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              {(
                [
                  ['Пешком', MURS_SPEED_CONSTANTS.walk.speedBlocksPerSec],
                  ['Бег', MURS_SPEED_CONSTANTS.walkSprint.speedBlocksPerSec],
                  ['Автомобиль', MURS_SPEED_CONSTANTS.auto.speedBlocksPerSec],
                  ['Велосипед', MURS_SPEED_CONSTANTS.bike.speedBlocksPerSec],
                  ['Самокат', MURS_SPEED_CONSTANTS.scooter.speedBlocksPerSec],
                  ['Электровел', MURS_SPEED_CONSTANTS.ebike.speedBlocksPerSec],
                  ['Автобус', MURS_SPEED_CONSTANTS.bus.speedBlocksPerSec],
                  ['Троллейбус', MURS_SPEED_CONSTANTS.trolleybus.speedBlocksPerSec],
                  ['Трамвай', MURS_SPEED_CONSTANTS.tram.speedBlocksPerSec],
                  ['Метро', MURS_SPEED_CONSTANTS.metro.speedBlocksPerSec],
                  ['Электричка', MURS_SPEED_CONSTANTS.rail.speedBlocksPerSec],
                ] as const
              ).map(([label, speed]) => (
                <div key={label} className="flex items-center justify-between gap-1">
                  <span className="text-neutral-600 dark:text-neutral-300 whitespace-nowrap">
                    {label}
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-white shrink-0">
                    {speed.toFixed(1)} м/с
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User Local Departure Time Controls (hidden in compact mobile view until expanded) */}
        {!compactMobile && (
          <div className="mt-2.5 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-neutral-50 dark:bg-[#252830] border border-neutral-200/80 dark:border-neutral-700/70">
            <div className="flex items-center gap-1.5 min-w-0">
              <Clock className="w-3.5 h-3.5 text-[#FC3F1D] shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 whitespace-nowrap">
                {departureTimeMode === 'now'
                  ? `Сейчас · ${formatLocalTimeRu(effectiveDepartureMs)}`
                  : 'Отправление:'}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {departureTimeMode === 'now' ? (
                <button
                  type="button"
                  onClick={() => {
                    onChangeCustomDepartureTime(formatLocalTimeRu(effectiveDepartureMs));
                    onChangeDepartureTimeMode('custom');
                  }}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 transition-colors whitespace-nowrap"
                >
                  Выбрать время
                </button>
              ) : (
                <>
                  <input
                    type="time"
                    aria-label="Локальное время отправления"
                    value={customDepartureTime}
                    onChange={(e) => onChangeCustomDepartureTime(e.target.value)}
                    className="h-7 px-1.5 rounded-lg bg-white dark:bg-[#1B1E24] border border-neutral-300 dark:border-neutral-600 text-xs font-mono tabular-nums text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#FFCC00]"
                  />
                  <button
                    type="button"
                    onClick={() => onChangeDepartureTimeMode('now')}
                    className="px-2 py-1 rounded-lg bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-[11px] font-bold transition-colors whitespace-nowrap"
                  >
                    Сейчас
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Mode comparison tabs (hidden on mobile compact sheet until both Point A & Point B are filled) */}
        {!hideExtrasForCompactMobile && (
          <div
            role="tablist"
            aria-label="Способ передвижения"
            className="grid grid-cols-4 gap-1 mt-2 p-1 rounded-xl bg-neutral-100 dark:bg-[#282B33]"
          >
            {(
              [
                { id: 'transit', label: 'Транспорт', shortLabel: 'Общ.', icon: TrainFront, sec: transitBestSec },
                { id: 'auto', label: 'Авто', shortLabel: 'Авто', icon: Car, sec: autoSec },
                { id: 'walk', label: 'Пешком', shortLabel: 'Пеш.', icon: Footprints, sec: walkSec },
                { id: 'sim', label: 'СИМ', shortLabel: 'СИМ', icon: Bike, sec: simSec },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = travelMode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={item.label}
                  onClick={() => onChangeTravelMode(item.id)}
                  className={`min-h-[44px] sm:min-h-[48px] flex flex-col items-center justify-center py-1 px-1 rounded-lg transition-all ${
                    active
                      ? 'bg-white dark:bg-[#1B1E24] text-neutral-950 dark:text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap">
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="hidden sm:inline">{item.id === 'transit' ? 'Общ.' : item.label}</span>
                    <span className="sm:hidden">{item.shortLabel}</span>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums mt-0.5 text-neutral-500 dark:text-neutral-400">
                    {item.sec ? formatDurationRu(item.sec) : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* SIM Vehicle Selector */}
        {!hideExtrasForCompactMobile && travelMode === 'sim' && (
          <div className="mt-2 flex items-center gap-1.5">
            {(['scooter', 'bike', 'ebike'] as SimVehicleType[]).map((veh) => {
              const p = SIM_PROFILES[veh];
              const active = simVehicle === veh;
              return (
                <button
                  key={veh}
                  type="button"
                  onClick={() => onChangeSimVehicle(veh)}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-teal-600 text-white'
                      : 'bg-neutral-100 dark:bg-[#2B2E37] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/80 dark:hover:bg-neutral-700'
                  }`}
                >
                  {p.shortLabel}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Autocomplete Dropdown or Route Details */}
      <div className="flex-1 overflow-y-auto murs-scroll px-4 py-2.5">
        {focusedField && activeSuggestions.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                Выбор точки {focusedField === 'A' ? 'А' : 'Б'}
              </span>
              <button
                type="button"
                onClick={() => setFocusedField(null)}
                className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                Закрыть
              </button>
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {activeSuggestions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectOption(focusedField, opt)}
                  className="w-full text-left py-2 px-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800/70 transition-colors flex items-center gap-2.5"
                >
                  {opt.stationId && stationById.has(opt.stationId) ? (
                    <TransitStopBadge
                      station={stationById.get(opt.stationId)!}
                      nearbyKinds={combinedModesMap.get(opt.stationId)}
                      size={22}
                    />
                  ) : opt.badgeType === 'icon' ? (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: opt.badgeColor || '#FC3F1D' }}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                      {opt.label}
                    </div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                      {opt.sublabel}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : activeRoute && compactMobile ? (
          /* Mobile Compact Slider View: Shortest route cards + manual expand button for details */
          <div className="space-y-2">
            {travelMode === 'transit' && transitRoutes.length > 0 ? (
              <div className="space-y-1.5">
                {transitRoutes.slice(0, 3).map((rt, idx) => {
                  const selected = idx === selectedTransitIdx;
                  return (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => onSelectTransitIdx(idx)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-colors ${
                        selected
                          ? 'border-[#FFCC00] bg-[#FFCC00]/14 dark:bg-[#FFCC00]/12'
                          : 'border-neutral-200 dark:border-neutral-700/80 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-base font-bold tabular-nums text-neutral-950 dark:text-white">
                          {formatDurationRu(rt.totalDurationSec)}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-neutral-600 dark:text-neutral-300">
                          {rt.departureTimeMs && rt.arrivalTimeMs
                            ? `${formatLocalTimeRu(rt.departureTimeMs)} → ${formatLocalTimeRu(rt.arrivalTimeMs)}`
                            : formatDistanceRu(rt.totalDistanceBlocks)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-neutral-600 dark:text-neutral-300 mt-0.5">
                        <span className="truncate">{rt.summary}</span>
                        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0">
                          {rt.transfers === 0
                            ? 'прямой'
                            : `${rt.transfers} перес.`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-2.5 rounded-xl border border-[#FFCC00] bg-[#FFCC00]/12 dark:bg-[#FFCC00]/10">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tabular-nums text-neutral-950 dark:text-white">
                    {formatDurationRu(activeRoute.totalDurationSec)}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-neutral-600 dark:text-neutral-300">
                    {activeRoute.departureTimeMs && activeRoute.arrivalTimeMs
                      ? `${formatLocalTimeRu(activeRoute.departureTimeMs)} → ${formatLocalTimeRu(activeRoute.arrivalTimeMs)} · `
                      : ''}
                    {formatDistanceRu(activeRoute.totalDistanceBlocks)}
                  </span>
                </div>
                <div className="text-xs text-neutral-600 dark:text-neutral-300 mt-0.5 truncate">
                  {activeRoute.summary}
                </div>
              </div>
            )}

            {onRequestExpandMobile && (
              <button
                type="button"
                onClick={onRequestExpandMobile}
                className="w-full h-9 px-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-[#282B33] dark:hover:bg-[#323642] text-neutral-900 dark:text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <ChevronUp className="w-4 h-4 text-[#FC3F1D]" aria-hidden="true" />
                <span>Развернуть подробности маршрута</span>
              </button>
            )}
          </div>
        ) : activeRoute ? (
          <div className="space-y-4">
            {/* Alternative Transit Options */}
            {travelMode === 'transit' && transitRoutes.length > 1 && (
              <div className="space-y-1.5">
                {transitRoutes.map((rt, idx) => {
                  const selected = idx === selectedTransitIdx;
                  return (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => onSelectTransitIdx(idx)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-colors ${
                        selected
                          ? 'border-[#FFCC00] bg-[#FFCC00]/12 dark:bg-[#FFCC00]/10'
                          : 'border-neutral-200 dark:border-neutral-700/80 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-base font-bold tabular-nums text-neutral-900 dark:text-white">
                          {formatDurationRu(rt.totalDurationSec)}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-neutral-600 dark:text-neutral-300">
                          {rt.departureTimeMs && rt.arrivalTimeMs
                            ? `${formatLocalTimeRu(rt.departureTimeMs)} → ${formatLocalTimeRu(rt.arrivalTimeMs)}`
                            : formatDistanceRu(rt.totalDistanceBlocks)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-neutral-600 dark:text-neutral-300 mt-1">
                        <span className="truncate">{rt.summary}</span>
                        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0">
                          {rt.transfers === 0
                            ? 'без пересадок'
                            : `${rt.transfers} ${rt.transfers === 1 ? 'пересадка' : 'пересадки'}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Active Route Summary Header */}
            <div className="pb-3 border-b border-neutral-200/80 dark:border-neutral-700/80">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-2xl font-bold tracking-tight tabular-nums text-neutral-950 dark:text-white">
                  {formatDurationRu(activeRoute.totalDurationSec)}
                </div>
                <div className="text-right">
                  {activeRoute.departureTimeMs && activeRoute.arrivalTimeMs && (
                    <div className="text-xs font-mono tabular-nums font-bold text-neutral-900 dark:text-white">
                      {formatLocalTimeRu(activeRoute.departureTimeMs)} →{' '}
                      {formatLocalTimeRu(activeRoute.arrivalTimeMs)}
                    </div>
                  )}
                  <div className="text-xs font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
                    {formatDistanceRu(activeRoute.totalDistanceBlocks)}
                  </div>
                </div>
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                {activeRoute.mode === 'transit' ? (
                  <>
                    <span>{activeRoute.summary}</span>
                    <span aria-hidden="true"> · </span>
                    <span>Пешком {formatDistanceRu(activeRoute.walkingDistanceBlocks)}</span>
                  </>
                ) : activeRoute.mode === 'auto' ? (
                  <>
                    <span>Поездка на автомобиле</span>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono tabular-nums">
                      ~{MURS_SPEED_CONSTANTS.auto.speedBlocksPerSec.toFixed(1)} м/с
                    </span>
                  </>
                ) : activeRoute.mode === 'sim' ? (
                  <>
                    <span>{SIM_PROFILES[simVehicle].label}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono tabular-nums">
                      ~{SIM_PROFILES[simVehicle].speedBlocksPerSec} м/с
                    </span>
                  </>
                ) : (
                  <>
                    <span>Пешеходный маршрут</span>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono tabular-nums">4,3 м/с</span>
                  </>
                )}
              </div>
            </div>

            {/* Step-by-step Route Legs */}
            <ol className="space-y-3" aria-label="Этапы маршрута">
              {activeRoute.legs.map((leg, idx) => {
                const isExpanded = !!expandedStops[idx];
                const intermediateCount = Math.max(0, (leg.stopsCount ?? 0) - 1);
                return (
                  <li key={`${leg.type}-${idx}`} className="flex gap-3">
                    {/* Vertical timeline spine */}
                    <div className="flex flex-col items-center pt-1">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 border-2 border-white dark:border-[#1E2027]"
                        style={{
                          backgroundColor:
                            leg.type === 'transit'
                              ? leg.routeColor || '#FC3F1D'
                              : leg.type === 'auto'
                              ? '#2563EB'
                              : leg.type === 'sim'
                              ? '#0D9488'
                              : '#3B82F6',
                        }}
                      />
                      {idx < activeRoute.legs.length - 1 && (
                        <div
                          className="w-0.5 flex-1 my-1 min-h-6"
                          style={{
                            backgroundColor:
                              leg.type === 'transit'
                                ? leg.routeColor || '#FC3F1D'
                                : leg.type === 'auto'
                                ? '#2563EB'
                                : leg.type === 'sim'
                                ? '#0D9488'
                                : '#93C5FD',
                          }}
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 leading-snug">
                          {leg.type === 'transit' && leg.transportKind ? (
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              {leg.transportKind === 'metro' &&
                              (leg.points.length === 0 ||
                                leg.points.some((pt) => isMuromorskCoordinate(pt.x, pt.z))) ? (
                                <MuromorskMetroBadge size={20} />
                              ) : (
                                <span
                                  className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-bold text-white leading-none"
                                  style={{ backgroundColor: leg.routeColor || '#FC3F1D' }}
                                >
                                  {leg.routeNumber || getTransportLabelRu(leg.transportKind)}
                                </span>
                              )}
                              <span>{leg.fromName}</span>
                            </span>
                          ) : (
                            leg.instruction
                          )}
                        </div>
                        <span className="text-xs font-mono tabular-nums font-semibold text-neutral-700 dark:text-neutral-300 shrink-0">
                          {formatDurationRu(leg.durationSec)}
                        </span>
                      </div>

                      <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        {leg.type === 'transit' ? (
                          <>
                            <span>до «{leg.toName}»</span>
                            {leg.departureTimeMs && leg.arrivalTimeMs && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums font-semibold text-neutral-700 dark:text-neutral-200">
                                  {formatLocalTimeRu(leg.departureTimeMs)} →{' '}
                                  {formatLocalTimeRu(leg.arrivalTimeMs)}
                                </span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">
                              {leg.stopsCount}{' '}
                              {leg.stopsCount === 1
                                ? 'остановка'
                                : leg.stopsCount && leg.stopsCount < 5
                                ? 'остановки'
                                : 'остановок'}
                            </span>
                            {leg.waitSec !== undefined && leg.waitSec > 0 ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">
                                  {leg.scheduledDeparture ? 'по расписанию, ждём' : 'ожидание ~'}{' '}
                                  {formatDurationRu(leg.waitSec)}
                                </span>
                              </>
                            ) : leg.scheduledDeparture ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>отправление сейчас</span>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span className="font-mono tabular-nums">
                              {formatDistanceRu(leg.distanceBlocks)}
                            </span>
                            {leg.departureTimeMs && leg.arrivalTimeMs && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  {formatLocalTimeRu(leg.departureTimeMs)}–{formatLocalTimeRu(leg.arrivalTimeMs)}
                                </span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span>
                              {leg.fromName} → {leg.toName}
                            </span>
                          </>
                        )}
                      </div>

                      {leg.type === 'transit' && intermediateCount > 0 && leg.stopNames && (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedStops((prev) => ({ ...prev, [idx]: !prev[idx] }))
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5" />
                                <span>Скрыть остановки</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
                                <span>Показать все остановки ({leg.stopNames.length})</span>
                              </>
                            )}
                          </button>
                          {isExpanded && (
                            <ul className="mt-1.5 pl-2.5 border-l border-neutral-200 dark:border-neutral-700 space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
                              {leg.stopNames.map((stName, sIdx) => (
                                <li key={`${stName}-${sIdx}`}>{stName}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : !compactMobile ? (
          <div className="space-y-3 py-2">
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Выберите точки А и Б через поиск (поддерживаются названия, адреса и типы вроде
              «вокзал», «библиотека», «тц») или укажите их прямо на карте.
            </p>
            <button
              type="button"
              onClick={() => onStartPickOnMap('A')}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#FFCC00] hover:bg-[#F2BF00] text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <MapPin className="w-4 h-4" aria-hidden="true" />
              <span>Указать точки А и Б на карте</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
